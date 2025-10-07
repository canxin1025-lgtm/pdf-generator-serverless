// 导入必要的库：pdfkit 用于生成 PDF，@supabase/supabase-js 用于数据库连接。
// 请确保在 package.json 中安装了这两个依赖。
const PDFDocument = require('pdfkit');
const { createClient } = require('@supabase/supabase-js');

// *** 环境变量配置 (Vercel 会自动注入) ***
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

// 检查环境变量是否存在
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables.");
    // 允许函数继续运行，但在错误发生时捕获
}

/**
 * 格式化数据库查询结果为可读的报告文本。
 * @param {object} data - 从 Supabase 获取的学生数据 (需要匹配您的 Supabase 表结构)
 * @returns {string[]} 格式化的文本行数组
 */
function formatStudentData(data) {
    // 假设 Supabase 表 (pajsk_records) 包含: name, id_card, class_name, co_curriculum, sport, uniform, service_etc
    if (!data) return ["未找到该身份证号码的学生信息。"];

    const report = [
        `PAJSK 报告 - ${new Date().getFullYear()} 年度`,
        '======================================================',
        `学生姓名 (NAMA MURID): ${data.name || 'N/A'}`,
        `身份证号码 (NO. IC): ${data.id_card || 'N/A'}`,
        `班级 (KELAS): ${data.class_name || 'N/A'}`,
        '======================================================',
        '【课外活动 (Co-Curriculum)】',
        `学会 (Kelab/Persatuan): ${data.co_curriculum || '无'}`,
        `体育 (Sukan/Permainan): ${data.sport || '无'}`,
        `制服团体 (Badan Beruniform): ${data.uniform || '无'}`,
        '======================================================',
        `备注 (CATATAN): ${data.service_etc || '无'}`,
        '',
        '此报告由系统自动生成，仅供家长核对。'
    ];
    return report;
}

/**
 * Serverless Function 主入口 (取代 getPdfUrl)。
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
        // 2. 查询数据 (模拟 Google Sheet 查询)
        const { data: records, error } = await supabase
            .from('pajsk_records') // 您的学生数据表名
            .select('*')
            .eq('id_card', idCardNumber)
            .single();

        if (error && error.code !== 'PGRST116') { // PGRST116: No rows found
            console.error('Supabase Query Error:', error);
            return res.status(500).json({ error: '数据库查询失败。' });
        }

        if (!records) {
            return res.status(404).json({ error: '未找到该身份证号码的 PAJSK 报告。' });
        }

        // 3. 生成 PDF
        const doc = new PDFDocument({ 
            size: 'A4', 
            margin: 50,
        });

        // 设置响应头，返回 PDF 文件
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="PAJSK_Report_${idCardNumber}.pdf"`);

        // 将 PDF 流式传输到 HTTP 响应
        doc.pipe(res);

        // 使用自定义函数格式化报告内容
        const reportLines = formatStudentData(records);

        // PDF 内容绘制
        doc.fontSize(20).text('PAJSK 学生报告 (Student Report)', { align: 'center' }).moveDown();
        doc.fontSize(16).fillColor('#3b82f6').text(records.name || 'N/A', { align: 'center' }).moveDown(1.5);
        
        doc.fillColor('black').fontSize(11);

        reportLines.forEach(line => {
            // 简单的排版处理
            if (line.includes('===')) {
                doc.moveDown(0.5).rect(doc.x, doc.y, doc.page.width - 100, 1).fill('black').moveDown(0.5);
            } else if (line.includes('【')) {
                doc.moveDown(0.5).fontSize(12).fillColor('#059669').text(line).moveDown(0.5);
                doc.fillColor('black').fontSize(11);
            } else {
                doc.text(line);
            }
        });
        
        doc.end(); // 结束 PDF 文档流

    } catch (error) {
        console.error('Server error during PDF generation:', error);
        if (!res.headersSent) {
             res.status(500).json({ error: '内部服务器错误：PDF 生成失败。' });
        } else {
             res.end(); 
        }
    }
};
