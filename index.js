/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.log.info("SentinelEngine PR Cost Analyzer Bot was loaded!");

  app.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async (context) => {
    app.log.info(`Received PR event for #${context.payload.pull_request.number}`);

    const prComment = context.issue({
      body: "⏳ **CloudGauge is analyzing your PR for Cloud Cost Impact...**",
    });
    const comment = await context.octokit.issues.createComment(prComment);

    try {
      const prNumber = context.payload.pull_request.number;
      const owner    = context.payload.repository.owner.login;
      const repo     = context.payload.repository.name;
      const baseSha  = context.payload.pull_request.base.sha;
      const headSha  = context.payload.pull_request.head.sha;

      // ── Step 1: Get changed files ──────────────────────────────────────────
      const { data: changedFiles } = await context.octokit.pulls.listFiles({
        owner, repo, pull_number: prNumber,
      });

      // ── Step 2: Fetch file content HERE in the bot using the installation
      //           token — this is GUARANTEED to have access to the repo.
      //           The server has no GitHub token, so we send content directly.
      const SUPPORTED = ['.ts', '.tsx', '.js', '.jsx'];
      const fileContents = [];

      for (const file of changedFiles) {
        if (file.status === 'removed') continue;
        if (!SUPPORTED.some(ext => file.filename.endsWith(ext))) continue;

        // Fetch HEAD content (the PR's version)
        let headContent = '';
        try {
          const { data } = await context.octokit.repos.getContent({
            owner, repo, path: file.filename, ref: headSha,
          });
          if (data.content) {
            headContent = Buffer.from(data.content, 'base64').toString('utf-8');
          }
        } catch (e) {
          app.log.warn(`Could not fetch HEAD content for ${file.filename}: ${e.message}`);
          continue;
        }

        // Fetch BASE content (what was there before the PR)
        let baseContent = '';
        if (file.status !== 'added') {
          try {
            const { data } = await context.octokit.repos.getContent({
              owner, repo, path: file.filename, ref: baseSha,
            });
            if (data.content) {
              baseContent = Buffer.from(data.content, 'base64').toString('utf-8');
            }
          } catch { /* treat as new file */ }
        }

        if (headContent.trim()) {
          fileContents.push({
            filename:    file.filename,
            status:      file.status,
            headContent,
            baseContent,
          });
        }
      }

      app.log.info(`Fetched ${fileContents.length} file(s) with content to analyze.`);

      // ── Step 3: Send content to CloudGauge server for AST analysis ────────
      const SERVER_URL = process.env.CLOUDGAUGE_SERVER_URL || 'http://localhost:3001';

      const response = await fetch(`${SERVER_URL}/api/bot/analyze-pr`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ owner, repo, prNumber, baseSha, headSha, fileContents }),
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${await response.text()}`);
      }

      const result = await response.json();

      // ── Step 4: Update the PR comment with the markdown result ─────────────
      await context.octokit.issues.updateComment({
        owner, repo,
        comment_id: comment.data.id,
        body: result.markdown,
      });

      // ── Step 5: Create GitHub Check Run (CI gate: fail if > $50/mo) ────────
      const isOverBudget = result.totalDeltaCents > 5000;
      await context.octokit.checks.create({
        owner, repo,
        name:       "CloudGauge Budget Policy",
        head_sha:   headSha,
        status:     "completed",
        conclusion: isOverBudget ? "failure" : "success",
        output: {
          title:   isOverBudget ? "💸 Budget Exceeded!" : "✅ Cost Approved",
          summary: `This PR introduces a monthly cloud cost of $${(Math.abs(result.totalDeltaCents) / 100).toFixed(2)}/mo. ${isOverBudget ? 'This exceeds the $50/mo budget limit.' : 'Within budget limits.'}`,
        },
      });

      app.log.info(`Successfully posted cost impact and CI check for PR #${prNumber}`);

    } catch (error) {
      app.log.error(error);
      await context.octokit.issues.updateComment({
        owner: context.payload.repository.owner.login,
        repo:  context.payload.repository.name,
        comment_id: comment.data.id,
        body: `❌ **CloudGauge Analysis Failed**\n\n\`\`\`\n${error.message}\n\`\`\``,
      });
    }
  });
};
