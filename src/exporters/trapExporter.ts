import { BaseExporter } from './baseExporter.js';

export interface TrapExporterResult {
    count: number;
}

export const runTrapExporter = async (): Promise<TrapExporterResult> => {
    const exporter = new BaseExporter({
        dataType: 'trap',
        dataFile: 'trapshazards.json',
        dataKey: 'trap',
        fluffFile: 'fluff-trapshazards.json',
        fluffKey: 'trapFluff',
    });
    
    const result = await exporter.run();
    return { count: result.count };
};
