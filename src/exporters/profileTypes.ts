export type OutputMode = 'file' | 'collection';

export type I18nStrategy = 'deep-first-level' | 'global-keyset';

export type ExportProfile = {
    dataType: string;
    sourceFile: string;
    rootKey: string;
    fluffFile?: string;
    fluffRootKey?: string;
    outputMode: OutputMode;
    i18nStrategy: I18nStrategy;
    forceCommonKeys?: string[];
    forceLocalizedKeys?: string[];
    skipKeys?: string[];
};
