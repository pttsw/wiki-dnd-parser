import { BaseExporter } from './baseExporter.js';

export interface RaceExporterResult {
    count: number;
}

export const runRaceExporter = async (): Promise<RaceExporterResult> => {
    const exporter = new BaseExporter({
        dataType: 'race',
        dataFile: 'races.json',
        dataKey: 'race',
        fluffFile: 'fluff-races.json',
        fluffKey: 'raceFluff',
    });
    
    const result = await exporter.run();
    return { count: result.count };
};
