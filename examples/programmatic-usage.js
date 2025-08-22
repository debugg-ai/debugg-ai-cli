// Example of using @debugg-ai/cli programmatically
const { runDebuggAITests } = require('@debugg-ai/cli');

async function runTests() {
  try {
    console.log('Starting DebuggAI tests...');
    
    const result = await runDebuggAITests({
      apiKey: process.env.DEBUGGAI_API_KEY,
      repoPath: process.cwd(),
      waitForServer: true,
      serverPort: 3000,
      testOutputDir: 'custom-tests',
      maxTestWaitTime: 300000 // 5 minutes
    });

    if (result.success) {
      console.log('✅ Tests completed successfully!');
      console.log(`Suite ID: ${result.suiteUuid}`);
      console.log('Generated test files:');
      result.testFiles?.forEach(file => {
        console.log(`  • ${file}`);
      });
    } else {
      console.error('❌ Tests failed:', result.error);
      process.exit(1);
    }
  } catch (error) {
    console.error('💥 Unexpected error:', error);
    process.exit(1);
  }
}

// Run if this file is executed directly
if (require.main === module) {
  runTests();
}

module.exports = { runTests };