import { promises as fs } from 'fs';

export interface ParallelTask<T> {
    id: string;
    fn: () => Promise<T>;
}

export async function runParallel<T>(
    tasks: ParallelTask<T>[],
    concurrency: number = 4
): Promise<Array<{ id: string; result: T; error?: Error }>> {
    const results: Array<{ id: string; result: T; error?: Error }> = [];
    const running: Promise<void>[] = [];
    const taskQueue = [...tasks];

    const executeTask = async (task: ParallelTask<T>, index: number) => {
        try {
            const result = await task.fn();
            results[index] = { id: task.id, result };
        } catch (error) {
            results[index] = { id: task.id, result: null as any, error: error as Error };
            console.warn(`[Parallel] Task ${task.id} failed:`, error);
        }
    };

    while (taskQueue.length > 0 || running.length > 0) {
        while (running.length < concurrency && taskQueue.length > 0) {
            const task = taskQueue.shift()!;
            const index = results.length;
            results.push(null as any);
            running.push(executeTask(task, index).then(() => {
                const idx = running.indexOf(running[running.length - 1]);
                if (idx > -1) running.splice(idx, 1);
            }));
        }
        if (running.length > 0) {
            await Promise.race(running);
        }
    }

    return results;
}

export async function readJsonFilesParallel<T>(filePaths: string[]): Promise<Array<{ path: string; data: T; error?: Error }>> {
    const tasks: ParallelTask<{ path: string; data: T }>[] = filePaths.map(path => ({
        id: path,
        fn: async () => {
            const content = await fs.readFile(path, 'utf-8');
            if (content.charCodeAt(0) === 0xFEFF) {
                return { path, data: JSON.parse(content.slice(1)) as T };
            }
            return { path, data: JSON.parse(content) as T };
        }
    }));

    const results = await runParallel(tasks, 8);
    return results.map(r => ({
        path: r.id,
        data: r.result?.data as T,
        error: r.error
    }));
}

export async function writeJsonFilesParallel(
    files: Array<{ path: string; data: any }>
): Promise<void> {
    const tasks: ParallelTask<void>[] = files.map(f => ({
        id: f.path,
        fn: async () => {
            const dir = require('path').dirname(f.path);
            await fs.mkdir(dir, { recursive: true });
            await fs.writeFile(f.path, JSON.stringify(f.data, null, 2), 'utf-8');
        }
    }));

    await runParallel(tasks, 8);
}
