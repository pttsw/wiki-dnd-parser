import type { WikiData } from './wiki';

export type MonsterOtherSource = {
    source: string;
    page?: number;
};

export type MonsterFileEntry = {
    name: string;
    ENG_name?: string;
    translator?: string;
    source: string;
    page?: number;
    otherSources?: MonsterOtherSource[];
    reprintedAs?: string[];
    hasFluff?: boolean;
    hasFluffImages?: boolean;
    [key: string]: any;
};

export type MonsterFile = {
    monster: MonsterFileEntry[];
};

export type MonsterFluffEntry = {
    name: string;
    ENG_name?: string;
    source: string;
    entries?: any[];
    images?: any[];
    [key: string]: any;
};

export type MonsterFluffFile = {
    monsterFluff: MonsterFluffEntry[];
};

export type MonsterFluffContent = {
    entries?: any[];
    images?: any[];
};

export type WikiBestiaryEntry = Record<string, any>;

export type WikiBestiaryData = WikiData<WikiBestiaryEntry, 'bestiary'> & {
    referenceSources?: { source: string; page: number }[];
    full?: {
        en?: MonsterFluffContent;
        zh?: MonsterFluffContent;
    };
};
