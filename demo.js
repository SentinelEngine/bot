

async function runDemo() {
  console.log("🤖 SentinelEngine Bot: Simulating incoming 'pull_request.opened' webhook...");
  
  // 1. Mock payload that GitHub would send to the Bot
  const payload = {
    owner: "SentinelEngine",
    repo: "cloudgauge-frontend",
    prNumber: 42,
    baseSha: "main",
    headSha: "feature-branch",
    files: [
      { filename: "src/app.ts", status: "modified" }
    ]
  };

  console.log("🤖 SentinelEngine Bot: Extracted PR files, forwarding to CloudGauge Backend...");

  // 2. The Bot forwards this metadata to the CloudGauge backend engine
  const SERVER_URL = 'http://localhost:3001';
  
  try {
    const response = await fetch(`${SERVER_URL}/api/bot/analyze-pr`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    const result = await response.json();
    
    // 3. The Bot receives the formatted markdown from the engine and posts it to the PR
    console.log("🤖 SentinelEngine Bot: Received Cost Analysis. Posting Comment to PR #42...\n");
    console.log("================== GITHUB PR COMMENT ==================");
    console.log(result.markdown);
    console.log("=======================================================");

  } catch (err) {
    console.error("❌ Bot failed to reach CloudGauge server. Is it running on port 3001?");
    console.error(err.message);
  }
}

runDemo().catch(console.error);
