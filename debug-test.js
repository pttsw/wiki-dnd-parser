import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

console.log('Starting loader...');
try {
    console.log('Registering ts-node/esm...');
    register('ts-node/esm', pathToFileURL('./'));
    console.log('Registered successfully!');
    
    console.log('Trying to import prepareData.ts...');
    await import('./src/prepareData.ts');
    console.log('Imported successfully!');
} catch (error) {
    console.error('ERROR OCCURRED:');
    console.error('Name:', error.name);
    console.error('Message:', error.message);
    console.error('Stack:', error.stack);
    console.error('Full error:', error);
}
