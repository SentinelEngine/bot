

/**
 * This is the main entrypoint to your Probot app
 * @param {import('probot').Probot} app
 */
export default (app) => {
  app.log.info("SentinelEngine PR Cost Analyzer Bot was loaded!");

  app.on(["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"], async (context) => {
    app.log.info(`Received PR event for #${context.payload.pull_request.number}`);

    // Create a loading comment
    const prComment = context.issue({
      body: "⏳ **SentinelEngine is analyzing your PR for Cloud Cost Impact...**",
    });
    const comment = await context.octokit.issues.createComment(prComment);

    try {
      const prNumber = context.payload.pull_request.number;
      const owner = context.payload.repository.owner.login;
      const repo = context.payload.repository.name;
      
      const baseSha = context.payload.pull_request.base.sha;
      const headSha = context.payload.pull_request.head.sha;

      // Fetch changed files
      const { data: files } = await context.octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Prepare payload to send to the CloudGauge server
      // We send the file names and the SHAs. Alternatively, we could fetch file contents here.
      // For simplicity and to let the bot be lightweight, we send the metadata to the server.
      // Since the server was previously doing the Octokit fetching, let's keep the server 
      // doing the deep AST analysis, and let the bot just forward the webhook.
      
      const payload = {
        owner,
        repo,
        prNumber,
        baseSha,
        headSha,
        files: files.map(f => ({ filename: f.filename, status: f.status }))
      };

      // Forward to CloudGauge core server for heavy lifting
      const SERVER_URL = process.env.CLOUDGAUGE_SERVER_URL || 'http://localhost:3001';
      
      const response = await fetch(`${SERVER_URL}/api/bot/analyze-pr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const result = await response.json();
      
      // Update the comment with the beautiful Markdown returned by the server
      await context.octokit.issues.updateComment({
        owner,
        repo,
        comment_id: comment.data.id,
        body: result.markdown
      });

      app.log.info(`Successfully posted cost impact for PR #${prNumber}`);

    } catch (error) {
      app.log.error(error);
      
      // Update comment with error
      await context.octokit.issues.updateComment({
        owner: context.payload.repository.owner.login,
        repo: context.payload.repository.name,
        comment_id: comment.data.id,
        body: `❌ **SentinelEngine Analysis Failed**\n\n\`\`\`\n${error.message}\n\`\`\``
      });
    }
  });
};
