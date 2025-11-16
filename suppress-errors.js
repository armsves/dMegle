// Suppress block range errors from Arkiv SDK
const originalError = console.error;
console.error = (...args) => {
  const message = args.join(' ');
  if (message.includes('exceed max block range') || 
      message.includes('max block range params') ||
      message.includes('InvalidInputRpcError')) {
    // Suppress these specific errors
    return;
  }
  originalError(...args);
};

