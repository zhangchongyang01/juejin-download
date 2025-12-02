import fse from "fs-extra";
import got from "got";

// 检查 cookies.json 文件
const checkCookies = () => {
    try {
        const cookies = fse.readJSONSync("./cookies.json");
        console.log("✅ cookies.json 文件存在");
        console.log(`📊 包含 ${cookies.length} 个 cookie`);
        
        // 检查关键 cookie
        const cookieNames = cookies.map(c => c.name);
        const importantCookies = ['sessionid', 'sid_guard', 'sid_tt', 'uid_tt'];
        
        importantCookies.forEach(name => {
            if (cookieNames.includes(name)) {
                console.log(`✅ 找到重要 cookie: ${name}`);
            } else {
                console.log(`❌ 缺少重要 cookie: ${name}`);
            }
        });
        
        return cookies;
    } catch (error) {
        console.error("❌ cookies.json 文件读取失败:", error.message);
        return null;
    }
};

// 测试 API 连接
const testAPI = async (cookies) => {
    if (!cookies) {
        console.error("❌ 无法测试 API，cookies 无效");
        return;
    }
    
    const cookie = cookies.reduce(
        (prev, curr) => prev + `${curr.name}=${curr.value};`,
        "",
    );
    
    try {
        console.log("\n🔍 测试 API 连接...");
        
        const response = await got
            .post("https://api.juejin.cn/booklet_api/v1/booklet/bookletshelflist", {
                headers: {
                    cookie: cookie,
                },
            })
            .json();
        
        console.log("✅ API 请求成功");
        console.log("📊 响应结构:");
        console.log(JSON.stringify(response, null, 2));
        
        if (response && response.data) {
            console.log(`✅ 找到 ${response.data.length} 本小册`);
        } else {
            console.log("❌ 响应中没有 data 字段");
        }
        
    } catch (error) {
        console.error("❌ API 请求失败:", error.message);
        if (error.response) {
            console.error("响应状态码:", error.response.statusCode);
            console.error("响应内容:", error.response.body);
        }
    }
};

// 主函数
const main = async () => {
    console.log("🔧 掘金小册下载器诊断工具");
    console.log("=".repeat(50));
    
    const cookies = checkCookies();
    await testAPI(cookies);
    
    console.log("\n" + "=".repeat(50));
    console.log("诊断完成");
};

main(); 