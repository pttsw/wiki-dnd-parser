import { promises as fs } from 'fs';
import path from 'path';

const config = {
    DATA_EN_DIR: './input/5e-en/data',
    DATA_ZH_DIR: './input/5e-cn/data',
};

export const loadFile = async <T = any>(filePath: string): Promise<{ en: T; zh: T }> => {
    const enFilePath = path.join(config.DATA_EN_DIR, filePath);
    const zhFilePath = path.join(config.DATA_ZH_DIR, filePath);
    try {
        const [enData, zhData] = await Promise.all([
            fs
                .readFile(enFilePath, 'utf-8')
                .then(JSON.parse)
                .catch(() => {
                    return {};
                }),
            fs
                .readFile(zhFilePath, 'utf-8')
                .then(JSON.parse)
                .catch(() => {
                    return {};
                }),
        ]);
        return { en: enData, zh: zhData };
    } catch (error) {
        console.error(`加载文件失败：${filePath}`, error);
        throw error;
    }
};

export const mwUtil = {
    isTitleValid: (title: string): { isValid: boolean; ch?: string; reason?: string } => {
        // check if title satisfies URL requirements
        const invalidChars = /[\\/:*?"<>|]/g;
        const invalidChar = title.match(invalidChars);
        if (invalidChar) {
            return {
                isValid: false,
                ch: invalidChar[0],
                reason: `包含URL无效字符："${invalidChar[0]}"(${invalidChar[0].charCodeAt(0)})`,
            };
        }
        // check if title satisfies mediawiki title requirements
        const mediaWikiInvalidChars = /[^\w\s-]/g;
        const mediaWikiInvalidChar = title.match(mediaWikiInvalidChars);
        if (mediaWikiInvalidChar) {
            return {
                isValid: false,
                ch: mediaWikiInvalidChar[0],
                reason: `包含MediaWiki无效字符："${mediaWikiInvalidChar[0]}"(${mediaWikiInvalidChar[0].charCodeAt(0)})`,
            };
        }
        return {
            isValid: true,
        };
    },   
    getMwTitle: (title: string): string => {
        return title.trim()
            .replace(/\\/g, '_0_')
            .replace(/\//g, '_9_')
            .replace(/:/g, '_2_')
            .replace(/\*/g, '_3_')
            .replace(/"/g, '_4_')
            .replace(/</g, '_5_')
            .replace(/>/g, '_6_')
            .replace(/\|/g, '_7_')
            .replace(/\?/g, '_8_');
    },
};

/**
 * 根据输入字符串生成一个字符串型ID。该ID可以被反向还原成源字符串。
 * 该ID应当仅包含安全的文字符号，且如果输入字符串较短，长度也应当较短。
 */
export const strCodec = {
    encode: (str: string): string => {
        return Buffer.from(str, 'utf-8').toString('base64');
    },
    decode: (str: string): string => {
        return Buffer.from(str, 'base64').toString('utf-8');
    },
};

export default config;
