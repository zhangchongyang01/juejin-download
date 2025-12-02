import got from "got";
import fse from "fs-extra";
import crypto from "crypto";
import { config } from "./lib/config.js";

const cookies = fse.readJSONSync("./cookies.json");

const cookie = cookies.reduce(
    (prev, curr) => prev + `${curr.name}=${curr.value};`,
    "",
);

/**
 * 带重试的 API 请求
 * @param {Function} requestFn - 请求函数
 * @param {number} maxRetries - 最大重试次数
 * @param {number} retryDelay - 重试延迟（毫秒）
 * @returns {Promise} 请求结果
 */
const requestWithRetry = async (requestFn, maxRetries = config.network.retryCount, retryDelay = config.network.retryDelay) => {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await requestFn();
        } catch (error) {
            lastError = error;
            
            // 如果是最后一次尝试，直接抛出错误
            if (attempt === maxRetries) {
                throw error;
            }
            
            // 等待后重试
            const delay = retryDelay * attempt;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    throw lastError;
};

export const getBooks = async () => {
    try {
        const response = await requestWithRetry(async () => {
            return await got
                .post("https://api.juejin.cn/booklet_api/v1/booklet/bookletshelflist", {
                    headers: {
                        cookie: cookie,
                    },
                    timeout: {
                        request: config.network.timeout,
                    },
                })
                .json();
        });

        // 检查响应结构
        if (!response) {
            throw new Error("API 响应为空");
        }

        if (!response.data) {
            throw new Error(`API 响应缺少 data 字段: ${JSON.stringify(response)}`);
        }

        if (!Array.isArray(response.data)) {
            throw new Error(`API 响应的 data 字段不是数组: ${JSON.stringify(response.data)}`);
        }

        const books = response.data.map((book) => ({
            value: book.booklet_id,
            name: book.base_info.title,
        }));

        return books;
    } catch (error) {
        console.error("获取小册列表失败:", error.message);
        console.error("完整错误:", error);
        throw error;
    }
};

export const getBookInfo = async (bookId) => {
    try {
        const response = await requestWithRetry(async () => {
            return await got
                .post("https://api.juejin.cn/booklet_api/v1/booklet/get", {
                    json: { booklet_id: bookId },
                    headers: {
                        cookie,
                    },
                    timeout: {
                        request: config.network.timeout,
                    },
                })
                .json();
        });

        // 检查响应结构
        if (!response || !response.data) {
            throw new Error(`获取小册信息失败，响应: ${JSON.stringify(response)}`);
        }

        const booklet = response.data.booklet;
        const sections = response.data.sections.map((section, index) => ({
            id: section.section_id,
            title: section.title,
            status: section.status,
            index: index + 1,
        }));
        
        return {
            booklet,
            sections,
        };
    } catch (error) {
        console.error(`获取小册信息失败 (ID: ${bookId}):`, error.message);
        throw error;
    }
};

export const getSection = async (sectionId) => {
    try {
        const response = await requestWithRetry(async () => {
            return await got
                .post("https://api.juejin.cn/booklet_api/v1/section/get", {
                    json: { section_id: sectionId },
                    headers: {
                        cookie,
                    },
                    timeout: {
                        request: config.network.timeout,
                    },
                })
                .json();
        });

        // 检查响应结构
        if (!response || !response.data || !response.data.section) {
            throw new Error(`获取章节信息失败，响应: ${JSON.stringify(response)}`);
        }

        return {
            title: response.data.section.title,
            content: response.data.section.markdown_show,
        };
    } catch (error) {
        console.error(`获取章节信息失败 (ID: ${sectionId}):`, error.message);
        throw error;
    }
};

/** 使用 Unicode 字符替换文件名中的特殊字符 */
export const replaceFileName = (fileName) => {
    // https://docs.microsoft.com/zh-cn/windows/desktop/FileIO/naming-a-file#naming_conventions
    const replaceMap = new Map([
        ['<', '\uFF1C'], // Fullwidth Less-Than Sign
        ['>', '\uFF1E'], // Fullwidth Greater-Than Sign
        [':', '\uFF1A'], // Fullwidth Colon
        ['/', '\uFF0F'], // Fullwidth Solidus
        ['\\', '\uFF3C'],// Fullwidth Reverse Solidus
        ['|', '\uFF5C'], // Fullwidth Vertical Line
        ['?', '\uFF1F'], // Fullwidth Question Mark
        ['*', '\uFF0A'], // Fullwidth Asterisk
        ['"', '\uFF02'], // Fullwidth Quotation Mark
    ]);

    const pattern = [...replaceMap.keys()].map((key) => "\\" + key).join("|");

    const regex = new RegExp(pattern, "g");

    return fileName.replace(regex, (match) => replaceMap.get(match));
};

/** 从 URL 生成图片文件名 */
export const generateImageFileName = (url) => {
    try {
        const urlObj = new URL(url);
        // 移除查询参数和哈希
        const pathname = urlObj.pathname;
        let fileName = path.basename(pathname);
        
        // 如果没有文件名或文件名无效，使用哈希值
        if (!fileName || !fileName.includes(".")) {
            const hash = crypto.createHash("md5").update(url).digest("hex").substring(0, 8);
            // 尝试从 URL 中提取扩展名
            const extMatch = url.match(/\.(jpg|jpeg|png|gif|webp|svg|bmp)(\?|#|$)/i);
            const ext = extMatch ? extMatch[1] : "jpg";
            fileName = `${hash}.${ext}`;
        } else {
            // 清理文件名，移除特殊字符
            fileName = fileName.replace(/[<>:"/\\|?*]/g, "_");
        }
        
        return fileName;
    } catch (error) {
        // 如果 URL 解析失败，使用哈希值
        const hash = crypto.createHash("md5").update(url).digest("hex").substring(0, 8);
        return `${hash}.jpg`;
    }
};

/** 计算文件内容的哈希值 */
export const calculateFileHash = (content) => {
    return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
};
