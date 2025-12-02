import fs from "fs";
import inquirer from "inquirer";
import fse from "fs-extra";

import { getBooks, getBookInfo, getSection, replaceFileName } from "./utils.js";
import { createLogger } from "./lib/logger.js";

// 创建日志实例
const log = createLogger("main");

const main = async () => {
    try {
        log.info("开始运行掘金小册下载器");
        const books = await getBooks();
        log.info(`获取到 ${books.length} 本小册`);
        
        const { bookId } = await inquirer.prompt([
            {
                type: "list",
                name: "bookId",
                message: "请选择要下载的小册",
                choices: books,
            },
        ]);
        log.info(`用户选择了小册ID: ${bookId}`);

        const { booklet, sections } = await getBookInfo(bookId);
        const bookName = booklet.base_info.title;

        fse.ensureDirSync(bookName);

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

        log.info(
            `获取目录成功：完结 ${finishSections.length}章，写作中 ${progressSections.length}章`,
        );

        for (let i = 0; i < finishSections.length; i++) {
            const section = finishSections[i];
            const sectionInfo = await getSection(section.id);

            const sectionName = replaceFileName(sectionInfo.title);

            const sectionPath = `${bookName}/${section.index}.${sectionName}.md`;

            fs.writeFileSync(sectionPath, sectionInfo.content);

            log.info(`第 ${section.index} 章下载完成`);
        }

        log.info(`小册 ${bookName} 下载完成`);
    } catch (error) {
        log.error(`运行过程中发生错误: ${error.message}`);
        log.error(`错误详情: ${error.stack}`);
        process.exit(1);
    }
};

main();
