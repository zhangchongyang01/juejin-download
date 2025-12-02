import fs from "fs";
import path from "path";
import fse from "fs-extra";
import got from "got";
import crypto from "crypto";
import { config } from "./lib/config.js";
import { createLogger } from "./lib/logger.js";
import { generateImageFileName, calculateFileHash } from "./utils.js";

// 配置常量
const DOWNLOADS_DIR = config.downloads.dir;
const OUTPUT_DIR = config.downloads.outputDir;
const IMAGES_DIR_NAME = config.downloads.imagesDirName;
const MAX_CONCURRENT = config.concurrency.maxConcurrent;
const TIMEOUT = config.network.timeout;
const RETRY_COUNT = config.network.retryCount;

// 创建日志实例
const log = createLogger("process-images");


// 下载单个图片
const downloadImage = async (url, localPath) => {
    // 如果文件已存在，跳过下载
    if (fs.existsSync(localPath)) {
        return true;
    }

    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            const response = await got(url, {
                timeout: { request: TIMEOUT },
                retry: { limit: 0 }, // 手动控制重试
            });

            // 确保目录存在
            fse.ensureDirSync(path.dirname(localPath));

            // 写入文件
            fs.writeFileSync(localPath, response.rawBody);
            return true;
        } catch (error) {
            if (attempt === RETRY_COUNT) {
                throw new Error(`下载失败 (尝试 ${attempt} 次): ${error.message}`);
            }
            // 等待后重试
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return false;
};

// 提取图片 URL（支持 Markdown 和 HTML 格式）
const extractImageUrls = (content) => {
    const urls = [];
    
    // Markdown 格式: ![alt](url) 或 ![alt](url "title")
    const markdownRegex = /!\[([^\]]*)\]\((https?:\/\/[^\s"\)]+)(?:\s+"([^"]*)")?\)/g;
    let match;
    while ((match = markdownRegex.exec(content)) !== null) {
        const [fullMatch, alt, url, title] = match;
        urls.push({
            fullMatch,
            url: url.trim(),
            type: "markdown",
            alt: alt || "",
            title: title || "",
        });
    }
    
    // HTML 格式: <img src="url" ...>
    const htmlRegex = /<img\s+[^>]*src=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    while ((match = htmlRegex.exec(content)) !== null) {
        const [fullMatch, url] = match;
        // 检查是否已经在 markdown 格式中匹配过（避免重复）
        const alreadyMatched = urls.some(item => 
            item.fullMatch === fullMatch || item.url === url.trim()
        );
        if (!alreadyMatched) {
            urls.push({
                fullMatch,
                url: url.trim(),
                type: "html",
            });
        }
    }
    
    return urls;
};

// 检查文件是否已处理过
const isFileProcessed = (filePath, outputFilePath, mappingPath) => {
    // 检查输出文件是否存在
    if (!fs.existsSync(outputFilePath)) {
        return false;
    }
    
    // 检查 mapping.json 是否存在
    if (!fs.existsSync(mappingPath)) {
        return false;
    }
    
    // 读取原始文件，检查是否有图片
    try {
        const content = fs.readFileSync(filePath, "utf-8");
        const contentHash = calculateFileHash(content);
        
        // 尝试从 mapping.json 中读取上次处理的文件哈希
        let mapping = {};
        let lastProcessedHash = null;
        
        try {
            const mappingContent = fs.readFileSync(mappingPath, "utf-8");
            mapping = JSON.parse(mappingContent);
            // 从 mapping.json 的元数据中获取文件哈希（如果存在）
            if (mapping._metadata && mapping._metadata.sourceFileHash) {
                lastProcessedHash = mapping._metadata.sourceFileHash;
            }
        } catch (error) {
            // 如果读取失败，认为未处理
            return false;
        }
        
        // 如果文件哈希不同，说明内容已更新，需要重新处理
        if (lastProcessedHash && lastProcessedHash !== contentHash) {
            return false;
        }
        
        const imageUrls = extractImageUrls(content);
        
        if (imageUrls.length === 0) {
            // 没有图片，只要输出文件存在且哈希匹配就认为已处理
            return lastProcessedHash === contentHash || !lastProcessedHash;
        }
        
        // 有图片，需要检查所有图片是否都已下载
        const imagesDir = path.join(path.dirname(outputFilePath), IMAGES_DIR_NAME);
        
        for (const imageInfo of imageUrls) {
            const imageFileName = generateImageFileName(imageInfo.url);
            const localImagePath = path.join(imagesDir, imageFileName);
            
            // 如果图片文件不存在，说明未完全处理
            if (!fs.existsSync(localImagePath)) {
                return false;
            }
        }
        
        // 所有图片都存在，且文件哈希匹配
        return lastProcessedHash === contentHash || !lastProcessedHash;
    } catch (error) {
        // 如果读取失败，认为未处理
        return false;
    }
};

// 处理单个 Markdown 文件
const processMarkdownFile = async (filePath, outputDir, imagesDir, mapping, mappingPath, missingImages, usedImageFiles) => {
    const fileName = path.basename(filePath);
    const outputFilePath = path.join(outputDir, fileName);
    
    try {
        // 读取原始文件内容
        const content = fs.readFileSync(filePath, "utf-8");
        const contentHash = calculateFileHash(content);
        
        // 检查是否已处理过
        const wasProcessed = isFileProcessed(filePath, outputFilePath, mappingPath);
        
        if (wasProcessed) {
            log.info(`${fileName}: 已处理过，跳过`);
            
            // 即使跳过，也要记录使用的图片文件（用于清理）
            const imageUrls = extractImageUrls(content);
            for (const imageInfo of imageUrls) {
                const imageFileName = generateImageFileName(imageInfo.url);
                usedImageFiles.add(imageFileName);
            }
            
            // 读取已存在的 mapping.json 来统计图片数量
            let existingImagesCount = 0;
            try {
                const existingMapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
                // 排除元数据
                existingImagesCount = Object.keys(existingMapping).filter(key => !key.startsWith("_")).length;
            } catch (error) {
                // 忽略错误
            }
            
            return { 
                processed: true, 
                skipped: true,
                imagesCount: existingImagesCount, 
                downloadedCount: 0 
            };
        }
        
        // 如果之前处理过但现在需要重新处理，记录日志
        if (fs.existsSync(outputFilePath)) {
            log.info(`${fileName}: 文件内容已更新，重新处理`);
        }
        
        // 提取所有图片 URL
        const imageUrls = extractImageUrls(content);
        
        if (imageUrls.length === 0) {
            log.info(`${fileName}: 没有找到图片，直接复制文件`);
            // 没有图片，直接复制文件
            fse.ensureDirSync(outputDir);
            fs.writeFileSync(outputFilePath, content, "utf-8");
            
            // 保存文件哈希到 mapping.json
            if (!mapping._metadata) {
                mapping._metadata = {};
            }
            mapping._metadata.sourceFileHash = contentHash;
            mapping._metadata.lastProcessed = new Date().toISOString();
            fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2), "utf-8");
            
            return { processed: true, imagesCount: 0, downloadedCount: 0 };
        }
        
        log.info(`${fileName}: 找到 ${imageUrls.length} 张图片`);
        
        let newContent = content;
        let downloadedCount = 0;
        const downloadPromises = [];
        const downloadResults = new Map(); // 存储每个图片的下载结果
        
        // 下载所有图片
        for (const imageInfo of imageUrls) {
            const { url, fullMatch, type, alt, title } = imageInfo;
            
            // 生成本地文件名和路径
            const imageFileName = generateImageFileName(url);
            const localImagePath = path.join(imagesDir, imageFileName);
            const relativeImagePath = path.join(IMAGES_DIR_NAME, imageFileName).replace(/\\/g, "/");
            
            // 记录使用的图片文件（用于后续清理）
            usedImageFiles.add(imageFileName);
            
            // 记录映射关系
            mapping[imageFileName] = {
                originalUrl: url,
                localPath: relativeImagePath,
            };
            
            // 检查图片是否已存在（缓存检查）
            const imageExists = fs.existsSync(localImagePath);
            if (imageExists) {
                log.info(`  ⊙ 使用缓存: ${imageFileName}`);
                downloadedCount++; // 统计时也算作成功
                downloadResults.set(fullMatch, { success: true, imageFileName, relativeImagePath, type, alt, title });
            } else {
                // 添加到下载队列
                const downloadPromise = downloadImage(url, localImagePath)
                    .then(() => {
                        downloadedCount++;
                    log.info(`  ✓ 下载成功: ${imageFileName}`);
                    downloadResults.set(fullMatch, { success: true, imageFileName, relativeImagePath, type, alt, title });
                })
                .catch((error) => {
                    log.error(`  ✗ 下载失败: ${imageFileName} - ${error.message}`);
                        // 记录缺失的图片
                        missingImages[imageFileName] = {
                            originalUrl: url,
                            expectedPath: relativeImagePath,
                            localFilePath: localImagePath,
                            error: error.message,
                            sourceFile: fileName,
                        };
                        downloadResults.set(fullMatch, { success: false, imageFileName, relativeImagePath, type, alt, title });
                    });
                
                downloadPromises.push(downloadPromise);
            }
        }
        
        // 等待所有下载完成（控制并发）
        const chunks = [];
        for (let i = 0; i < downloadPromises.length; i += MAX_CONCURRENT) {
            chunks.push(downloadPromises.slice(i, i + MAX_CONCURRENT));
        }
        
        for (const chunk of chunks) {
            await Promise.all(chunk);
        }
        
        // 只替换下载成功的图片链接，失败的保持原始 URL
        for (const imageInfo of imageUrls) {
            const { fullMatch } = imageInfo;
            const result = downloadResults.get(fullMatch);
            
            if (result && result.success) {
                // 只替换下载成功的图片
                if (result.type === "markdown") {
                    // 如果有 title，保留 title；否则只保留 alt
                    const titlePart = result.title ? ` "${result.title}"` : "";
                    const newMarkdown = `![${result.alt}](${result.relativeImagePath}${titlePart})`;
                    newContent = newContent.replace(fullMatch, newMarkdown);
                } else if (result.type === "html") {
                    // 替换 HTML img 标签中的 src
                    const newHtml = fullMatch.replace(/src=["']([^"']+)["']/i, `src="${result.relativeImagePath}"`);
                    newContent = newContent.replace(fullMatch, newHtml);
                }
            }
            // 如果下载失败，不替换链接，保持原始 URL
        }
        
        // 保存处理后的文件
        fse.ensureDirSync(outputDir);
        fs.writeFileSync(outputFilePath, newContent, "utf-8");
        
        // 保存文件哈希到 mapping.json 的元数据中
        if (!mapping._metadata) {
            mapping._metadata = {};
        }
        mapping._metadata.sourceFileHash = contentHash;
        mapping._metadata.lastProcessed = new Date().toISOString();
        
        const failedCount = imageUrls.length - downloadedCount;
        log.info(`${fileName}: 处理完成，下载了 ${downloadedCount}/${imageUrls.length} 张图片`);
        if (failedCount > 0) {
            log.warn(`${fileName}: 下载失败 ${failedCount} 张图片`);
        }
        
        return {
            processed: true,
            imagesCount: imageUrls.length,
            downloadedCount,
            failedCount,
        };
    } catch (error) {
        log.error(`处理文件失败 ${fileName}: ${error.message}`);
        return {
            processed: false,
            error: error.message,
        };
    }
};

// 处理单个文件夹
const processFolder = async (folderPath, outputBaseDir) => {
    const folderName = path.basename(folderPath);
    const outputFolderPath = path.join(outputBaseDir, folderName);
    const imagesDir = path.join(outputFolderPath, IMAGES_DIR_NAME);
    
    log.info(`\n开始处理文件夹: ${folderName}`);
    log.info("=".repeat(50));
    
    // 获取所有 .md 文件
    const files = fs.readdirSync(folderPath)
        .filter(file => file.endsWith(".md"))
        .map(file => path.join(folderPath, file));
    
        if (files.length === 0) {
            log.warn(`${folderName}: 没有找到 .md 文件`);
            return { processed: 0, total: 0, imagesCount: 0, downloadedCount: 0, failedCount: 0 };
        }
    
    log.info(`${folderName}: 找到 ${files.length} 个 .md 文件`);
    
    // 创建输出目录和图片目录
    fse.ensureDirSync(outputFolderPath);
    fse.ensureDirSync(imagesDir);
    
    // 映射关系
    const mapping = {};
    
    let processedCount = 0;
    let totalImagesCount = 0;
    let totalDownloadedCount = 0;
    
    // 映射关系文件路径
    const mappingPath = path.join(outputFolderPath, "mapping.json");
    const missingImagesPath = path.join(outputFolderPath, "missing-images.json");
    
    // 记录当前处理过程中使用的所有图片文件名
    const usedImageFiles = new Set();
    
    // 如果 mapping.json 已存在，尝试加载已有的映射关系
    let existingMapping = {};
    if (fs.existsSync(mappingPath)) {
        try {
            existingMapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
            // 排除元数据
            const imageMappings = Object.keys(existingMapping).filter(key => !key.startsWith("_"));
            log(`加载已有映射关系: ${imageMappings.length} 条记录`);
        } catch (error) {
            log(`加载已有映射关系失败: ${error.message}`, "WARN");
        }
    }
    
    // 缺失图片记录
    const missingImages = {};
    
    let skippedCount = 0;
    let totalFailedCount = 0;
    
    // 处理每个文件
    for (const file of files) {
        const result = await processMarkdownFile(file, outputFolderPath, imagesDir, mapping, mappingPath, missingImages, usedImageFiles);
        if (result.processed) {
            processedCount++;
            if (result.skipped) {
                skippedCount++;
            }
            totalImagesCount += result.imagesCount || 0;
            totalDownloadedCount += result.downloadedCount || 0;
            totalFailedCount += result.failedCount || 0;
        }
    }
    
    // 清理不再使用的图片文件
    let cleanedCount = 0;
    let cleanedSize = 0;
    
    // 获取所有图片文件
    if (fs.existsSync(imagesDir)) {
        const allImageFiles = fs.readdirSync(imagesDir);
        
        for (const imageFile of allImageFiles) {
            // 检查是否在当前使用的图片列表中
            if (!usedImageFiles.has(imageFile)) {
                const imagePath = path.join(imagesDir, imageFile);
                try {
                    const stats = fs.statSync(imagePath);
                    cleanedSize += stats.size;
                    fs.unlinkSync(imagePath);
                    cleanedCount++;
                    log.info(`  清理未使用的图片: ${imageFile}`);
                } catch (error) {
                    log.warn(`  清理图片失败: ${imageFile} - ${error.message}`);
                }
            }
        }
    }
    
    // 清理 mapping.json 中不再使用的图片记录
    const cleanedMapping = {};
    // 保留元数据
    if (mapping._metadata) {
        cleanedMapping._metadata = mapping._metadata;
    }
    // 只保留当前使用的图片映射
    for (const imageFile of usedImageFiles) {
        if (mapping[imageFile]) {
            cleanedMapping[imageFile] = mapping[imageFile];
        }
    }
    
    // 保存清理后的映射关系
    fs.writeFileSync(mappingPath, JSON.stringify(cleanedMapping, null, 2), "utf-8");
    log.info(`\n映射关系已保存到: ${mappingPath}`);
    
    if (cleanedCount > 0) {
        const cleanedSizeMB = (cleanedSize / 1024 / 1024).toFixed(2);
        log.info(`清理了 ${cleanedCount} 个未使用的图片文件，释放空间 ${cleanedSizeMB} MB`);
    }
    
    // 保存缺失图片映射
    if (Object.keys(missingImages).length > 0) {
        fs.writeFileSync(missingImagesPath, JSON.stringify(missingImages, null, 2), "utf-8");
        log.info(`缺失图片映射已保存到: ${missingImagesPath}`);
        log.info(`缺失图片数量: ${Object.keys(missingImages).length}`);
    } else if (fs.existsSync(missingImagesPath)) {
        // 如果没有缺失图片，删除旧的缺失图片文件
        fs.unlinkSync(missingImagesPath);
        log.info(`所有图片已下载完成，已删除旧的缺失图片映射文件`);
    }
    
    log.info(`\n${folderName}: 处理完成`);
    log.info(`  - 处理文件: ${processedCount}/${files.length}`);
    log.info(`  - 跳过文件: ${skippedCount}`);
    log.info(`  - 图片总数: ${totalImagesCount}`);
    log.info(`  - 下载成功: ${totalDownloadedCount}`);
    log.info(`  - 下载失败: ${totalFailedCount}`);
    if (cleanedCount > 0) {
        log.info(`  - 清理未使用图片: ${cleanedCount} 个`);
    }
    
    return {
        processed: processedCount,
        skipped: skippedCount,
        total: files.length,
        imagesCount: totalImagesCount,
        downloadedCount: totalDownloadedCount,
        failedCount: totalFailedCount,
        cleanedCount,
    };
};

// 主函数
const main = async () => {
    try {
        // 确保 log 文件夹存在
        fse.ensureDirSync("log");
        
        log.info("开始批量处理 Markdown 文件中的图片");
        log.info("=".repeat(50));
        
        // 检查 downloads 目录是否存在
        if (!fs.existsSync(DOWNLOADS_DIR)) {
            log.error(`错误: ${DOWNLOADS_DIR} 目录不存在`);
            process.exit(1);
        }
        
        // 获取所有子文件夹
        const folders = fs.readdirSync(DOWNLOADS_DIR)
            .filter(item => {
                const itemPath = path.join(DOWNLOADS_DIR, item);
                return fs.statSync(itemPath).isDirectory();
            })
            .map(item => path.join(DOWNLOADS_DIR, item));
        
        if (folders.length === 0) {
            log.warn(`在 ${DOWNLOADS_DIR} 中没有找到子文件夹`);
            return;
        }
        
        log.info(`找到 ${folders.length} 个文件夹需要处理`);
        
        // 创建输出目录
        fse.ensureDirSync(OUTPUT_DIR);
        
        const results = {
            totalFolders: folders.length,
            processedFolders: 0,
            totalFiles: 0,
            processedFiles: 0,
            skippedFiles: 0,
            totalImages: 0,
            totalDownloaded: 0,
            totalFailed: 0,
        };
        
        // 处理每个文件夹
        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];
            log.info(`\n进度: ${i + 1}/${folders.length}`);
            
            const result = await processFolder(folder, OUTPUT_DIR);
            
            results.processedFolders++;
            results.totalFiles += result.total;
            results.processedFiles += result.processed;
            results.skippedFiles += result.skipped || 0;
            results.totalImages += result.imagesCount;
            results.totalDownloaded += result.downloadedCount;
            results.totalFailed += result.failedCount || 0;
            // 注意：cleanedCount 是文件夹级别的统计，不需要累加到总结果中
        }
        
        // 输出最终统计
        log.info("\n" + "=".repeat(50));
        log.info("批量处理完成！");
        log.info(`总计文件夹: ${results.totalFolders}`);
        log.info(`处理文件: ${results.processedFiles}/${results.totalFiles}`);
        log.info(`跳过文件: ${results.skippedFiles}`);
        log.info(`图片总数: ${results.totalImages}`);
        log.info(`下载成功: ${results.totalDownloaded}`);
        log.info(`下载失败: ${results.totalFailed}`);
        log.info(`输出目录: ${OUTPUT_DIR}`);
        
        if (results.totalFailed > 0) {
            log.warn(`\n提示: 有 ${results.totalFailed} 张图片下载失败，请查看各文件夹下的 missing-images.json 文件`);
            log.info(`可以使用 fix-missing-images.js 脚本尝试重新下载或手动处理`);
        }
        
    } catch (error) {
        log.error(`处理过程中发生错误: ${error.message}`);
        log.error(`错误详情: ${error.stack}`);
        process.exit(1);
    }
};

// 运行主函数
main();

