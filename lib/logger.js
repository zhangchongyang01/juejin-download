/**
 * 统一日志系统
 * 支持日志级别、文件日志、日志轮转
 */

import fs from "fs";
import path from "path";
import fse from "fs-extra";
import { config } from "./config.js";

// 日志级别
const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
};

// 当前日志级别
const currentLogLevel = LOG_LEVELS[config.logging.logLevel] || LOG_LEVELS.INFO;

// 日志文件路径映射
const logFiles = new Map();

/**
 * 获取日志文件路径（按日期）
 * @param {string} prefix - 日志文件前缀
 * @returns {string} 日志文件路径
 */
const getLogFilePath = (prefix) => {
    const today = new Date();
    const dateStr = today.toISOString().split("T")[0]; // YYYY-MM-DD
    const logDir = config.logging.logDir;
    return path.join(logDir, `${prefix}-${dateStr}.log`);
};

/**
 * 确保日志目录存在
 */
const ensureLogDir = () => {
    if (config.logging.enableFileLogging) {
        fse.ensureDirSync(config.logging.logDir);
    }
};

/**
 * 写入日志文件
 * @param {string} logFilePath - 日志文件路径
 * @param {string} message - 日志消息
 */
const writeToFile = (logFilePath, message) => {
    if (!config.logging.enableFileLogging) {
        return;
    }
    
    try {
        ensureLogDir();
        fs.appendFileSync(logFilePath, message + "\n", "utf-8");
    } catch (error) {
        // 如果写入失败，只输出到控制台
        console.error(`写入日志文件失败: ${error.message}`);
    }
};

/**
 * 格式化日志消息
 * @param {string} level - 日志级别
 * @param {string} message - 日志消息
 * @returns {string} 格式化后的日志消息
 */
const formatMessage = (level, message) => {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level}] ${message}`;
};

/**
 * 日志类
 */
class Logger {
    constructor(prefix = "app") {
        this.prefix = prefix;
        this.logFilePath = getLogFilePath(prefix);
        logFiles.set(prefix, this.logFilePath);
    }
    
    /**
     * 记录日志
     * @param {string} level - 日志级别
     * @param {string} message - 日志消息
     */
    log(level, message) {
        const levelValue = LOG_LEVELS[level];
        if (levelValue === undefined || levelValue < currentLogLevel) {
            return;
        }
        
        const logMessage = formatMessage(level, message);
        
        // 输出到控制台
        if (level === "ERROR") {
            console.error(logMessage);
        } else if (level === "WARN") {
            console.warn(logMessage);
        } else {
            console.log(logMessage);
        }
        
        // 写入日志文件
        writeToFile(this.logFilePath, logMessage);
    }
    
    /**
     * DEBUG 级别日志
     */
    debug(message) {
        this.log("DEBUG", message);
    }
    
    /**
     * INFO 级别日志
     */
    info(message) {
        this.log("INFO", message);
    }
    
    /**
     * WARN 级别日志
     */
    warn(message) {
        this.log("WARN", message);
    }
    
    /**
     * ERROR 级别日志
     */
    error(message) {
        this.log("ERROR", message);
    }
}

/**
 * 创建日志实例
 * @param {string} prefix - 日志文件前缀
 * @returns {Logger} 日志实例
 */
export const createLogger = (prefix) => {
    return new Logger(prefix);
};

/**
 * 默认日志实例
 */
export const logger = createLogger("app");

/**
 * 获取所有日志文件路径
 * @returns {Map} 日志文件路径映射
 */
export const getLogFiles = () => {
    return new Map(logFiles);
};

