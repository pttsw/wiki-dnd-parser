console.log('Test script started');

// 直接运行时的入口
if (import.meta.url === `file://${process.argv[1]}`) {
    console.log('Test script executed as main');
}