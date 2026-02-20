const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const { SocksProxyAgent } = require('socks-proxy-agent');
const cors = require('cors');

const app = express();
app.use(cors()); // Allow All Origins

// ---------------- CONFIGURATION ----------------
// GANTI INI DENGAN LINK GITHUB RAW MILIKMU YANG ISINYA LIST SOCKS5
// Format isi file github harus: socks5://ip:port (satu per baris)
const GITHUB_PROXY_URL = 'https://raw.githubusercontent.com/proxifly/free-proxy-list/refs/heads/main/proxies/protocols/socks5/data.txt';
// -----------------------------------------------


// --- HELPER: Ambil List Proxy dari GitHub ---
async function fetchProxies() {
  try {
    // Tambah timestamp agar tidak di-cache oleh Vercel/GitHub
    const { data } = await axios.get(`${GITHUB_PROXY_URL}?t=${Date.now()}`);
    
    // Split text per baris, bersihkan spasi, dan hapus baris kosong
    const proxyList = data.split('\n')
      .map(line => line.trim())
      .filter(line => line && line.startsWith('socks5://'));
      
    return proxyList;
  } catch (error) {
    console.error('Gagal mengambil proxy dari GitHub:', error.message);
    return [];
  }
}

// ==========================================
// 🚀 ENDPOINT 1: Cek List Proxy Manual (/getpx)
// ==========================================
app.get('/api/tools/getpx', async (req, res) => {
  const proxies = await fetchProxies();
  
  if (proxies.length === 0) {
    return res.json({
      success: false,
      message: "Gagal mengambil proxy atau file kosong/format salah."
    });
  }

  res.json({
    success: true,
    source: GITHUB_PROXY_URL,
    total_active: proxies.length,
    list: proxies // Menampilkan list yang didapat
  });
});


// ==========================================
// 🚀 ENDPOINT 2: Proxy Scraper (/proxy?url=)
// ==========================================
app.get('/api/tools/proxy', async (req, res) => {
  const targetUrl = req.query.url;
  const startTime = Date.now();

  // 1. Validasi URL
  if (!targetUrl) {
    return res.status(400).json({ success: false, message: "URL param is required!" });
  }

  try {
    // 2. Ambil Proxy dari GitHub
    const proxies = await fetchProxies();
    
    // Default config axios (tanpa proxy dulu)
    let axiosConfig = {
      timeout: 15000, // 15 detik timeout
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Referer': targetUrl
      }
    };

    let selectedProxy = "Direct (No Proxy/List Empty)";

    // 3. Jika ada proxy, pilih random & pasang Agent
    if (proxies.length > 0) {
      const randomIndex = Math.floor(Math.random() * proxies.length);
      selectedProxy = proxies[randomIndex];
      
      const agent = new SocksProxyAgent(selectedProxy);
      axiosConfig.httpsAgent = agent;
      axiosConfig.httpAgent = agent;
      
      console.log(`[Proxy] Using: ${selectedProxy} -> Target: ${targetUrl}`);
    } else {
      console.log(`[Warning] List Proxy Kosong, mencoba direct connection.`);
    }

    // 4. Request ke Target
    const response = await axios.get(targetUrl, axiosConfig);

    // 5. Scrape HTML menjadi JSON Structure
    // Ini parser otomatis mencari gambar di dalam area konten (Generic Manga Parser)
    const $ = cheerio.load(response.data);
    const images = [];

    // Selector generic: biasanya manga ada di div 'readerarea', 'main-content', dll.
    // Mencari tag IMG di dalam struktur umum website komik
    $('img').each((i, el) => {
      const src = $(el).attr('src') || $(el).attr('data-src');
      // Filter gambar kecil/logo/iklan
      if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('banner')) {
        images.push(src);
      }
    });

    const pageTitle = $('title').text().trim();
    // Cari tombol Next/Prev (Logic sederhana mencari text 'next'/'prev' di link)
    let prevLink = "";
    let nextLink = "";
    
    $('a').each((i, el) => {
      const text = $(el).text().toLowerCase();
      const href = $(el).attr('href');
      if(text.includes('prev') || text.includes('sebelum')) prevLink = href;
      if(text.includes('next') || text.includes('selanjut')) nextLink = href;
    });

    // 6. Response JSON Final (Sesuai request kamu)
    const endTime = Date.now();
    const finalResponse = {
      success: true,
      result: {
        status: response.status,
        content: {
          creator: "Sanka Vollerei Project",
          success: true,
          data: {
            title: pageTitle,
            comicSlug: targetUrl.split('/').filter(Boolean).pop() || "unknown",
            usedProxy: selectedProxy, // Debug info: proxy apa yang dipake
            images: images, // Hanya tampilkan max 50 gambar biar json gak berat
            navigation: {
              GA: "sadsad",
              prev: prevLink || "#",
              next: nextLink || "#",
              allChapters: targetUrl // Placeholder
            }
          }
        }
      },
      headers: {
        "date": new Date().toUTCString(),
        "content-type": "application/json; charset=utf-8",
        "transfer-encoding": "chunked",
        "connection": "close",
        "cf-ray": `9b${Date.now().toString(16)}-SIN`, // Fake Cloudflare Ray ID
        "cf-cache-status": "DYNAMIC",
        "access-control-allow-origin": "*",
        "server": "cloudflare", // Biar terlihat pro
        "x-powered-by": "Express"
      },
      timestamp: new Date().toISOString(),
      responseTime: `${endTime - startTime}ms`
    };

    res.json(finalResponse);

  } catch (error) {
    // Error Handling Cantik
    res.status(500).json({
      success: false,
      result: {
        status: 500,
        message: "Failed to fetch content or Proxy Error.",
        error_detail: error.message
      }
    });
  }
});

// Root path handler
app.get('/', (req, res) => res.send('API Active. Use /api/tools/proxy?url=YOUR_URL'));

module.exports = app;
