import fs from "fs";
import path from "path";
import fse from "fs-extra";
import got from "got";
import { config } from "./lib/config.js";
import { createLogger } from "./lib/logger.js";
import { generateImageFileName } from "./utils.js";

const OUTPUT_DIR = config.downloads.outputDir;
const IMAGES_DIR_NAME = config.downloads.imagesDirName;
const TIMEOUT = config.network.timeout;
const RETRY_COUNT = config.network.retryCount;

// 创建日志实例
const log = createLogger("fix-images");


// 尝试下载图片
const tryDownloadImage = async (url, localPath) => {
    for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        try {
            const response = await got(url, {
                timeout: { request: TIMEOUT },
                retry: { limit: 0 },
            });
            
            fse.ensureDirSync(path.dirname(localPath));
            fs.writeFileSync(localPath, response.rawBody);
            return true;
        } catch (error) {
            if (attempt === RETRY_COUNT) {
                throw new Error(`下载失败 (尝试 ${attempt} 次): ${error.message}`);
            }
            await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
    }
    return false;
};

// 扫描文件夹，找出缺失的图片和未映射的图片
const scanForMissingImages = (folderPath) => {
    const mappingPath = path.join(folderPath, "mapping.json");
    const missingImagesPath = path.join(folderPath, "missing-images.json");
    
    const missing = [];
    const orphaned = [];
    
    // 检查 missing-images.json
    if (fs.existsSync(missingImagesPath)) {
        try {
            const missingImages = JSON.parse(fs.readFileSync(missingImagesPath, "utf-8"));
            const imagesDir = path.join(folderPath, IMAGES_DIR_NAME);
            
            for (const [fileName, info] of Object.entries(missingImages)) {
                const imagePath = path.join(imagesDir, fileName);
                if (!fs.existsSync(imagePath)) {
                    missing.push({
                        fileName,
                        originalUrl: info.originalUrl,
                        expectedPath: info.localFilePath || path.join(imagesDir, fileName),
                        error: info.error,
                        sourceFile: info.sourceFile,
                    });
                }
            }
        } catch (error) {
            log.warn(`读取 missing-images.json 失败: ${error.message}`);
        }
    }
    
    // 检查 mapping.json 中缺失的图片
    if (fs.existsSync(mappingPath)) {
        try {
            const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf-8"));
            const imagesDir = path.join(folderPath, IMAGES_DIR_NAME);
            
            for (const [fileName, info] of Object.entries(mapping)) {
                // 排除元数据字段（以 _ 开头的键）
                if (fileName.startsWith("_")) {
                    continue;
                }
                
                const imagePath = path.join(imagesDir, fileName);
                if (!fs.existsSync(imagePath)) {
                    // 检查是否已经在 missing 列表中
                    const alreadyInMissing = missing.some(item => item.fileName === fileName);
                    if (!alreadyInMissing) {
                        missing.push({
                            fileName,
                            originalUrl: info.originalUrl,
                            expectedPath: imagePath,
                            error: "文件不存在",
                            sourceFile: "未知",
                        });
                    }
                }
            }
        } catch (error) {
            log.warn(`读取 mapping.json 失败: ${error.message}`);
        }
    }
    
    // 检查 images 文件夹中未映射的图片
    const imagesDir = path.join(folderPath, IMAGES_DIR_NAME);
    if (fs.existsSync(imagesDir)) {
        try {
            const mapping = fs.existsSync(mappingPath) 
                ? JSON.parse(fs.readFileSync(mappingPath, "utf-8"))
                : {};
            
            const files = fs.readdirSync(imagesDir)
                .filter(file => {
                    const filePath = path.join(imagesDir, file);
                    return fs.statSync(filePath).isFile();
                });
            
            for (const file of files) {
                // 排除元数据字段，只检查实际的图片映射
                // 如果文件不在 mapping 中（排除元数据字段），就认为是未映射的图片
                if (!mapping[file]) {
                    orphaned.push({
                        fileName: file,
                        filePath: path.join(imagesDir, file),
                    });
                }
            }
        } catch (error) {
            log.warn(`扫描未映射图片失败: ${error.message}`);
        }
    }
    
    return { missing, orphaned };
};

// 更新 missing-images.json
const updateMissingImagesFile = (folderPath, missingImages) => {
    const missingImagesPath = path.join(folderPath, "missing-images.json");
    
    if (Object.keys(missingImages).length === 0) {
        // 如果没有缺失图片，删除文件
        if (fs.existsSync(missingImagesPath)) {
            fs.unlinkSync(missingImagesPath);
            log.info(`已删除缺失图片映射文件（所有图片已下载）`);
        }
    } else {
        // 保存更新后的缺失图片映射
        fs.writeFileSync(missingImagesPath, JSON.stringify(missingImages, null, 2), "utf-8");
        log.info(`已更新缺失图片映射文件: ${Object.keys(missingImages).length} 条记录`);
    }
};

// 处理单个文件夹
const processFolder = async (folderPath) => {
    const folderName = path.basename(folderPath);
    log.info(`\n处理文件夹: ${folderName}`);
    log.info("=".repeat(50));
    
    const { missing, orphaned } = scanForMissingImages(folderPath);
    
    if (missing.length === 0 && orphaned.length === 0) {
        log.info(`  没有缺失或未映射的图片`);
        return { fixed: 0, failed: 0, orphaned: orphaned.length };
    }
    
    let fixedCount = 0;
    let failedCount = 0;
    const missingImagesPath = path.join(folderPath, "missing-images.json");
    let missingImages = {};
    
    // 加载现有的 missing-images.json
    if (fs.existsSync(missingImagesPath)) {
        try {
            missingImages = JSON.parse(fs.readFileSync(missingImagesPath, "utf-8"));
        } catch (error) {
            log.warn(`加载缺失图片映射失败: ${error.message}`);
        }
    }
    
    // 尝试下载缺失的图片
    if (missing.length > 0) {
        log.info(`  发现 ${missing.length} 张缺失图片，开始尝试下载...`);
        
        for (const item of missing) {
            log.info(`  尝试下载: ${item.fileName}`);
            log.info(`    原始URL: ${item.originalUrl}`);
            
            try {
                const success = await tryDownloadImage(item.originalUrl, item.expectedPath);
                if (success) {
                    log.info(`  ✓ 下载成功: ${item.fileName}`);
                    fixedCount++;
                    // 从缺失列表中移除
                    delete missingImages[item.fileName];
                } else {
                    log.error(`  ✗ 下载失败: ${item.fileName}`);
                    failedCount++;
                }
            } catch (error) {
                log.error(`  ✗ 下载失败: ${item.fileName} - ${error.message}`);
                failedCount++;
                // 更新错误信息
                if (missingImages[item.fileName]) {
                    missingImages[item.fileName].error = error.message;
                }
            }
        }
    }
    
    // 报告未映射的图片
    if (orphaned.length > 0) {
        log.info(`  发现 ${orphaned.length} 张未映射的图片（可能是手动下载的）:`);
        for (const item of orphaned) {
            log.info(`    - ${item.fileName}`);
            log.info(`      路径: ${item.filePath}`);
        }
        log.info(`  提示: 这些图片已存在但未在 mapping.json 中，可能需要手动处理`);
    }
    
    // 更新 missing-images.json
    updateMissingImagesFile(folderPath, missingImages);
    
    log.info(`\n${folderName}: 处理完成`);
    log.info(`  - 修复成功: ${fixedCount}`);
    log.info(`  - 修复失败: ${failedCount}`);
    log.info(`  - 未映射图片: ${orphaned.length}`);
    
    return {
        fixed: fixedCount,
        failed: failedCount,
        orphaned: orphaned.length,
    };
};

// 主函数
const main = async () => {
    try {
        
        log.info("开始修复缺失的图片");
        log.info("=".repeat(50));
        
        if (!fs.existsSync(OUTPUT_DIR)) {
            log.error(`错误: ${OUTPUT_DIR} 目录不存在`);
            log.info(`请先运行 process-images.js 脚本`);
            process.exit(1);
        }
        
        const folders = fs.readdirSync(OUTPUT_DIR)
            .filter(item => {
                const itemPath = path.join(OUTPUT_DIR, item);
                return fs.statSync(itemPath).isDirectory();
            })
            .map(item => path.join(OUTPUT_DIR, item));
        
        if (folders.length === 0) {
            log.warn(`在 ${OUTPUT_DIR} 中没有找到子文件夹`);
            return;
        }
        
        log.info(`找到 ${folders.length} 个文件夹需要检查`);
        
        const results = {
            totalFolders: folders.length,
            processedFolders: 0,
            totalFixed: 0,
            totalFailed: 0,
            totalOrphaned: 0,
        };
        
        // 处理每个文件夹
        for (let i = 0; i < folders.length; i++) {
            const folder = folders[i];
            log.info(`\n进度: ${i + 1}/${folders.length}`);
            
            const result = await processFolder(folder);
            
            results.processedFolders++;
            results.totalFixed += result.fixed;
            results.totalFailed += result.failed;
            results.totalOrphaned += result.orphaned;
        }
        
        // 输出最终统计
        log.info("\n" + "=".repeat(50));
        log.info("修复完成！");
        log.info(`总计文件夹: ${results.totalFolders}`);
        log.info(`修复成功: ${results.totalFixed}`);
        log.info(`修复失败: ${results.totalFailed}`);
        log.info(`未映射图片: ${results.totalOrphaned}`);
        
        if (results.totalFailed > 0) {
            log.warn(`\n提示: 仍有 ${results.totalFailed} 张图片无法下载`);
            log.info(`请检查网络连接或手动下载图片到对应位置`);
        }
        
        if (results.totalOrphaned > 0) {
            log.warn(`\n提示: 发现 ${results.totalOrphaned} 张未映射的图片`);
            log.info(`这些图片已存在但未在 mapping.json 中，可能需要手动添加到映射关系`);
        }
        
    } catch (error) {
        log.error(`处理过程中发生错误: ${error.message}`);
        log.error(`错误详情: ${error.stack}`);
        process.exit(1);
    }
};

// 运行主函数
main();

