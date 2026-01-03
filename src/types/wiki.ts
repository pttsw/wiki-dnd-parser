import type { ParagraphGroup } from './typography';
import type { ItemListEntry } from './items';

// WikiData: 所有输出到wiki用的单条数据类型，移除了大多数无用字段。

export type WikiData<T, U extends string> = {
    dataType: U;
    uid: string;
    id: string;

    displayName: {
        zh: string | null;
        en: string | null;
    };
    mainSource: {
        source: string;
        page: number;
    };
    allSources: { source: string; page: number }[];
    relatedVersions?: string[]; // 相关版本 ID 列表（通过 reprintedAs 追踪）
    zh: T | null;
    en: T;
};
