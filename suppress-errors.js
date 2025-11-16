// Suppress block range errors from Arkiv SDK
const originalError = console.error;
console.error = (...args) => {
  const message = args.join(' ');
  
  // Suppress block range errors and related error messages
  if (message.includes('exceed max block range') || 
      message.includes('max block range params') ||
      message.includes('InvalidInputRpcError') ||
      message.includes('error from subscribeEntityEvents')) {
    // Silently suppress these errors - they're expected and don't affect functionality
    return;
  }
  
  originalError(...args);
};

export {}; // Make this a module

