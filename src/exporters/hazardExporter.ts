import { BaseExporter } from './baseExporter.js';

export interface HazardExporterResult {
    count: number;
}

export const runHazardExporter = async (): Promise<HazardExporterResult> => {
    const exporter = new BaseExporter({
        dataType: 'hazard',
        dataFile: 'trapshazards.json',
        dataKey: 'hazard',
        fluffFile: 'fluff-trapshazards.json',
        fluffKey: 'hazardFluff',
    });
    
    const result = await exporter.run();
    return { count: result.count };
};
