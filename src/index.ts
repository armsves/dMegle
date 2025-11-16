/**
 * Arkiv Task Board - CLI Demo
 * 
 * This script demonstrates the core Arkiv features:
 * - CRUD operations (Create, Read, Update)
 * - TTL/Expiration management
 * - Real-time subscriptions
 * - Query filtering
 */

// Import error suppression first to suppress expected block range errors
import '../suppress-errors.js';

import { ArkivTaskBoard } from './arkiv-client.js';
import { config } from './config.js';

async function main() {
  console.log('🎯 Arkiv Task Board Demo\n');
  console.log(`Account: ${config.privateKey ? '***' + config.privateKey.slice(-8) : 'Not configured'}`);
  console.log(`RPC: ${config.rpcUrl}\n`);

  const taskBoard = new ArkivTaskBoard();
  const accountAddress = taskBoard.getAccountAddress();
  
  console.log(`✅ Connected to Arkiv Testnet`);
  console.log(`📝 Account Address: ${accountAddress}\n`);

  // Set up real-time subscriptions
  console.log('📡 Setting up real-time subscriptions...');
  try {
    await taskBoard.subscribeToTasks({
      onTaskCreated: (task) => {
        console.log(`\n✨ [LIVE] Task Created: "${task.title}" (${task.entityKey.slice(0, 8)}...)`);
      },
      onTaskUpdated: (task) => {
        console.log(`\n🔄 [LIVE] Task Updated: "${task.title}" → ${task.status}`);
      },
      onTaskExtended: (entityKey, newExpirationBlock) => {
        console.log(`\n⏰ [LIVE] Task Extended: ${entityKey.slice(0, 8)}... → block ${newExpirationBlock}`);
      },
      onError: (error) => {
        // Silently ignore block range errors - subscriptions still work for new events
        const errorMsg = error?.message || String(error);
        if (!errorMsg.includes('exceed max block range') && 
            !errorMsg.includes('max block range params') &&
            !errorMsg.includes('InvalidInputRpcError')) {
          console.error('\n❌ [Subscription Error]', errorMsg);
        }
        // Block range errors are expected and harmless - subscriptions work for new events
      },
    });
    console.log('✅ Subscriptions active\n');
  } catch (error: any) {
    // Handle initial subscription setup error (block range issue)
    if (error.message?.includes('exceed max block range')) {
      console.log('⚠️  Subscription setup: Block range limit hit (this is normal)');
      console.log('   Subscriptions will still work for new events going forward\n');
    } else {
      console.error('❌ Failed to set up subscriptions:', error.message);
      throw error;
    }
  }

  // Demo: Create tasks
  console.log('📝 Creating demo tasks...\n');
  
  const task1Key = await taskBoard.createTask({
    title: 'Implement user authentication',
    description: 'Add login and signup functionality',
    assignee: accountAddress,
    priority: 3,
    expiresIn: 3600, // 1 hour
  });
  console.log(`✅ Created task 1: ${task1Key}`);

  const task2Key = await taskBoard.createTask({
    title: 'Design database schema',
    description: 'Plan the data model for the application',
    assignee: accountAddress,
    priority: 2,
    expiresIn: 7200, // 2 hours
  });
  console.log(`✅ Created task 2: ${task2Key}`);

  const task3Key = await taskBoard.createTask({
    title: 'Write API documentation',
    description: 'Document all endpoints and usage examples',
    assignee: accountAddress,
    priority: 1,
    expiresIn: 86400, // 24 hours
  });
  console.log(`✅ Created task 3: ${task3Key}\n`);

  // Wait a bit for transactions to settle
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Demo: Query tasks
  console.log('🔍 Querying tasks...\n');
  
  const allTasks = await taskBoard.queryTasks({ activeOnly: true });
  console.log(`📊 Found ${allTasks.length} active tasks:`);
  allTasks.forEach((task, i) => {
    const expiresInHours = (task.expiresIn / 3600).toFixed(1);
    console.log(`  ${i + 1}. [${task.status.toUpperCase()}] ${task.title}`);
    console.log(`     Priority: ${task.priority} | Expires in: ${expiresInHours}h`);
  });

  // Query by status
  const todoTasks = await taskBoard.queryTasks({ status: 'todo', activeOnly: true });
  console.log(`\n📋 Todo tasks: ${todoTasks.length}`);

  // Query by priority
  const highPriorityTasks = await taskBoard.queryTasks({ minPriority: 3, activeOnly: true });
  console.log(`⭐ High priority tasks (≥3): ${highPriorityTasks.length}\n`);

  // Demo: Update task
  console.log('🔄 Updating task status...\n');
  const updatedTaskKey = await taskBoard.updateTask(task1Key, {
    status: 'in-progress',
  });
  console.log(`✅ Updated task: ${updatedTaskKey}`);
  
  const updatedTask = await taskBoard.getTask(updatedTaskKey);
  if (updatedTask) {
    console.log(`   New status: ${updatedTask.status}\n`);
  }

  // Demo: Extend expiration
  console.log('⏰ Extending task expiration...\n');
  const extendTxHash = await taskBoard.extendTask(task2Key, 3600); // Add 1 hour
  console.log(`✅ Extended task expiration. TX: ${extendTxHash}\n`);

  // Final query
  console.log('🔍 Final task summary...\n');
  const finalTasks = await taskBoard.queryTasks({ activeOnly: true });
  finalTasks.forEach((task) => {
    const expiresInHours = (task.expiresIn / 3600).toFixed(1);
    console.log(`  • ${task.title} [${task.status}] - Expires in ${expiresInHours}h`);
  });

  console.log('\n✨ Demo complete!');
  console.log('💡 Keep this process running to see real-time updates');
  console.log('   Try creating/updating tasks from another client to see live events.\n');
}

main().catch((error) => {
  console.error('❌ Error:', error);
  process.exit(1);
});

