import fs from "fs";
import path from "path";
import fse from "fs-extra";
import crypto from "crypto";
import { getBooks, getBookInfo, getSection, replaceFileName, calculateFileHash } from "./utils.js";
import { config } from "./lib/config.js";
import { createLogger } from "./lib/logger.js";

// 创建日志实例
const log = createLogger("batch-download");


// 检查文件是否存在且内容是否相同
const shouldDownloadFile = async (filePath, newContent) => {
    // 如果文件不存在，需要下载
    if (!fs.existsSync(filePath)) {
        return { shouldDownload: true, reason: "文件不存在" };
    }
    
    // 读取已存在文件的内容
    try {
        const existingContent = fs.readFileSync(filePath, "utf-8");
        const existingHash = calculateFileHash(existingContent);
        const newHash = calculateFileHash(newContent);
        
        // 如果哈希值不同，说明内容已更新，需要重新下载
        if (existingHash !== newHash) {
            return { shouldDownload: true, reason: "内容已更新" };
        }
        
        return { shouldDownload: false, reason: "内容相同" };
    } catch (error) {
        // 如果读取失败，重新下载
        return { shouldDownload: true, reason: `读取文件失败: ${error.message}` };
    }
};

// 检查小册是否已下载完成
const isBookDownloaded = (bookName, sections) => {
    const bookDir = path.join(process.cwd(), bookName);
    
    // 检查目录是否存在
    if (!fs.existsSync(bookDir)) {
        return false;
    }
    
    // 检查所有完结章节是否都已下载
    const finishedSections = sections.filter(section => section.status === 1);
    
    for (const section of finishedSections) {
        const sectionPath = path.join(bookDir, `${section.index}.${replaceFileName(section.title)}.md`);
        if (!fs.existsSync(sectionPath)) {
            return false;
        }
    }
    
    return true;
};

// 下载单个小册
const downloadBook = async (book) => {
    const { bookId, name } = book;
    
    try {
        log.info(`开始下载小册: ${name} (ID: ${bookId})`);
        
        const { booklet, sections } = await getBookInfo(bookId);
        const bookName = booklet.base_info.title;
        
        // 创建目录
        fse.ensureDirSync(bookName);
        
        // 分离完结和写作中的章节
        const [finishSections, progressSections] = sections.reduce(
            (prev, curr) => {
                if (curr.status === 1) {
                    prev[0].push(curr);
                } else {
                    prev[1].push(curr);
                }
                return prev;
            },
            [[], []],
        );
        
        log.info(`获取目录成功：完结 ${finishSections.length}章，写作中 ${progressSections.length}章`);
        
        let downloadedCount = 0;
        let skippedCount = 0;
        let updatedCount = 0;
        
        // 下载完结的章节
        for (let i = 0; i < finishSections.length; i++) {
            const section = finishSections[i];
            const sectionName = replaceFileName(section.title);
            const sectionPath = `${bookName}/${section.index}.${sectionName}.md`;
            
            try {
                // 先获取章节内容
                const sectionInfo = await getSection(section.id);
                
                // 检查是否需要下载（包括内容更新检测）
                const { shouldDownload, reason } = await shouldDownloadFile(sectionPath, sectionInfo.content);
                
                if (!shouldDownload) {
                    log.info(`第 ${section.index} 章已存在且内容相同，跳过: ${sectionName}`);
                    skippedCount++;
                    continue;
                }
                
                // 如果文件存在但内容不同，记录为更新
                if (fs.existsSync(sectionPath) && reason === "内容已更新") {
                    log.info(`第 ${section.index} 章内容已更新，重新下载: ${sectionName}`);
                    updatedCount++;
                }
                
                // 写入文件
                fs.writeFileSync(sectionPath, sectionInfo.content);
                log.info(`第 ${section.index} 章下载完成: ${sectionName} (${reason})`);
                downloadedCount++;
            } catch (error) {
                log.error(`第 ${section.index} 章下载失败: ${sectionName} - ${error.message}`);
            }
        }
        
        log.info(`小册 ${bookName} 下载完成 - 新增: ${downloadedCount}章, 更新: ${updatedCount}章, 跳过: ${skippedCount}章`);
        
        return { 
            success: true, 
            skipped: false, 
            bookName, 
            downloadedCount, 
            skippedCount,
            updatedCount,
            totalSections: finishSections.length
        };
        
    } catch (error) {
        log.error(`下载小册 ${name} 失败: ${error.message}`);
        return { success: false, bookName: name, error: error.message };
    }
};

// 主函数
const main = async () => {
    try {
        log.info("开始批量下载掘金小册");
        log.info("=".repeat(50));
        
        // 获取所有小册列表
        const books = await getBooks();
        log.info(`获取到 ${books.length} 本小册`);
        
        const results = {
            total: books.length,
            success: 0,
            failed: 0,
            skipped: 0,
            totalDownloaded: 0,
            totalUpdated: 0,
            totalSkipped: 0
        };
        
        // 逐个下载小册
        for (let i = 0; i < books.length; i++) {
            const book = books[i];
            log.info(`进度: ${i + 1}/${books.length} - ${book.name}`);
            
            const result = await downloadBook({bookId: book.value, name: book.name});
            
            if (result.success) {
                if (result.skipped) {
                    results.skipped++;
                } else {
                    results.success++;
                    results.totalDownloaded += result.downloadedCount || 0;
                    results.totalUpdated += result.updatedCount || 0;
                    results.totalSkipped += result.skippedCount || 0;
                }
            } else {
                results.failed++;
            }
            
            // 添加延迟避免请求过于频繁
            if (i < books.length - 1) {
                await new Promise(resolve => setTimeout(resolve, config.network.requestDelay));
            }
        }
        
        // 输出最终统计
        log.info("=".repeat(50));
        log.info("批量下载完成！");
        log.info(`总计: ${results.total} 本小册`);
        log.info(`成功: ${results.success} 本`);
        log.info(`跳过: ${results.skipped} 本`);
        log.info(`失败: ${results.failed} 本`);
        log.info(`新增章节: ${results.totalDownloaded} 章`);
        log.info(`更新章节: ${results.totalUpdated} 章`);
        log.info(`跳过章节: ${results.totalSkipped} 章`);
        
    } catch (error) {
        log.error(`批量下载过程中发生错误: ${error.message}`);
        process.exit(1);
    }
};

// 运行主函数
main(); 