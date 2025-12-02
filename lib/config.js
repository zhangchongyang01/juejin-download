/**
 * 配置管理模块
 * 集中管理所有配置项，支持环境变量覆盖
 */

// 默认配置
const defaultConfig = {
    // 下载配置
    downloads: {
        dir: "downloads",
        outputDir: "downloads-with-images",
        imagesDirName: "images",
    },
    
    // 网络配置
    network: {
        timeout: 30000, // 请求超时时间（毫秒）
        retryCount: 3, // 重试次数
        retryDelay: 1000, // 重试延迟（毫秒）
        requestDelay: 1000, // 请求之间的延迟（毫秒）
    },
    
    // 并发配置
    concurrency: {
        maxConcurrent: 5, // 最大并发下载数
    },
    
    // 日志配置
    logging: {
        logDir: "log",
        enableFileLogging: true,
        logLevel: process.env.LOG_LEVEL || "INFO", // DEBUG, INFO, WARN, ERROR
    },
};

// 从环境变量加载配置
const loadConfigFromEnv = () => {
    const config = { ...defaultConfig };
    
    // 网络配置
    if (process.env.NETWORK_TIMEOUT) {
        config.network.timeout = parseInt(process.env.NETWORK_TIMEOUT, 10);
    }
    if (process.env.RETRY_COUNT) {
        config.network.retryCount = parseInt(process.env.RETRY_COUNT, 10);
    }
    if (process.env.REQUEST_DELAY) {
        config.network.requestDelay = parseInt(process.env.REQUEST_DELAY, 10);
    }
    
    // 并发配置
    if (process.env.MAX_CONCURRENT) {
        config.concurrency.maxConcurrent = parseInt(process.env.MAX_CONCURRENT, 10);
    }
    
    // 日志配置
    if (process.env.LOG_LEVEL) {
        config.logging.logLevel = process.env.LOG_LEVEL;
    }
    if (process.env.ENABLE_FILE_LOGGING === "false") {
        config.logging.enableFileLogging = false;
    }
    
    return config;
};

// 导出配置
export const config = loadConfigFromEnv();

// 导出配置获取函数
export const getConfig = (path) => {
    const keys = path.split(".");
    let value = config;
    for (const key of keys) {
        if (value && typeof value === "object" && key in value) {
            value = value[key];
        } else {
            return undefined;
        }
    }
    return value;
};

