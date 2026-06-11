import { runClassExporter } from './src/exporters/classExporter.js';

async function test() {
    console.log('Testing classExporter...');
    try {
        const result = await runClassExporter();
        console.log(`Class count: ${result.classCount}`);
        console.log(`Subclass count: ${result.subclassCount}`);
        console.log('Test completed successfully!');
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

test();
