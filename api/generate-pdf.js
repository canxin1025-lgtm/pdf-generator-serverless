// 导入必要的库：@supabase/supabase-js 用于数据库和存储服务连接。
// 注意：动态生成 PDF 的 pdfkit 库已被移除。
const { createClient } = require('@supabase/supabase-js');

// *** 环境变量配置 (Vercel 会自动注入) ***
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// 检查环境变量是否存在
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
    // 允许函数继续运行，但在错误发生时捕获
}

// 假设配置:
const BUCKET_NAME = 'pajsk-reports'; // 【重要】请替换成您在 Supabase 中创建的存储桶名称
const SIGNED_URL_EXPIRY_SECONDS = 3600; // 签名链接有效期 (1小时)

/**
 * Serverless Function 主入口 (取代 getPdfUrl)。
 * 接收身份证号码，返回对应 PDF 文件的临时访问链接。
 */
module.exports = async (req, res) => {
    // 设置 CORS 头部
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Method Not Allowed.' });
        return;
    }

    let idCardNumber;
    try {
        const body = req.body;
        if (!body || !body.idCardNumber) {
            return res.status(400).json({ error: '请求错误：缺少学生身份证号码。' });
        }
        idCardNumber = String(body.idCardNumber).trim();
    } catch (e) {
        return res.status(400).json({ error: '请求错误：JSON 格式无效。' });
    }
    
    // 1. 连接 Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false }, 
    });

    try {
        // 2. 【第一步】查询数据库以确认学生记录存在（替代原 Google Sheet 查找）
        const { data: records, error: dbError } = await supabase
            .from('pajsk_records') // 您的学生数据表名
            .select('id_card') // 只需要查询ID来确认记录存在
            .eq('id_card', idCardNumber)
            .single();

        if (dbError && dbError.code !== 'PGRST116') { // PGRST116: No rows found
            console.error('Supabase Query Error:', dbError);
            return res.status(500).json({ error: '数据库查询失败。' });
        }

        if (!records) {
            return res.status(404).json({ error: '未找到该身份证号码的 PAJSK 报告记录。' });
        }
        
        // 3. 【第二步】构造文件路径 (假设文件名为：身份证号码.pdf)
        // 假设您的文件存储在 bucket 的根目录，或者在名为 'reports' 的文件夹内。
        const FILE_PATH = `reports/${idCardNumber}.pdf`; 
        
        // 4. 【第三步】从 Supabase Storage 生成 PDF 文件的临时签名链接
        const { data: signedUrlData, error: storageError } = await supabase.storage
            .from(BUCKET_NAME)
            .createSignedUrl(FILE_PATH, SIGNED_URL_EXPIRY_SECONDS); 

        if (storageError) {
             console.error('Supabase Storage Error:', storageError);
             // 如果文件不存在或存储桶访问权限问题，会返回此错误。
             return res.status(404).json({ error: '未找到该身份证号码对应的 PDF 报告文件。' });
        }
        
        // 5. 成功返回链接 (以 JSON 格式返回，前端需要获取 pdfUrl 字段)
        return res.status(200).json({ 
            pdfUrl: signedUrlData.signedUrl,
            message: '成功获取成绩单链接。'
        });

    } catch (error) {
        console.error('Server error during URL generation:', error);
        return res.status(500).json({ error: '内部服务器错误：无法处理请求。' });
    }
};
