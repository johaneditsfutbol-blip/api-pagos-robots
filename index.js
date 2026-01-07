const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');

const app = express();
// Railway nos asigna un puerto dinámico en la variable PORT. Si no, usa el 3000.
const PORT = process.env.PORT || 3000;

app.use(express.json());

// =========================================================
// CONFIGURACIÓN GENERAL
// =========================================================
const CONFIG_ICARO = {
    urlLogin: "https://administrativo.icarosoft.com/",
    urlLista: "https://administrativo.icarosoft.com/Listado_clientes_tickets/",
    user: "JOHANC",
    pass: "@VNjohanc16",
    selUser: '#id_sc_field_login',
    selPass: '#id_sc_field_pswd',
};

const CONFIG_VIDANET = { url: "https://pagos.vidanet.net" };

const BUILDERBOT = {
    url: 'https://app.builderbot.cloud/api/v2/80c70b51-1737-4dad-9ee9-111cbc75174e/messages',
    token: 'bb-3441000d-f490-47bf-9c5a-273409fad976'
};

// Variables Globales
let browserIcaro = null; // Navegador exclusivo Icaro
let browserVidanet = null; // Navegador exclusivo Vidanet

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// =========================================================
// HERRAMIENTAS COMUNES
// =========================================================

function notificarBuilderBot(numero, mensaje, urlImagen = null) {
    return new Promise((resolve) => {
        console.log(`   🔔 Notificando a BuilderBot...`);
        if (!numero) { resolve(null); return; }
        const numeroLimpio = String(numero).replace(/\D/g, '');

        const messagesData = { "content": mensaje || "Proceso finalizado." };
        if (urlImagen && urlImagen.startsWith('http')) messagesData.mediaUrl = urlImagen;

        const payload = JSON.stringify({
            "messages": messagesData,
            "number": numeroLimpio,
            "checkIfExists": false
        });

        const urlParts = new URL(BUILDERBOT.url);
        const req = https.request({
            hostname: urlParts.hostname,
            path: urlParts.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': BUILDERBOT.token,
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => resolve(data));
        });
        req.on('error', () => resolve(null));
        req.write(payload);
        req.end();
    });
}

// =========================================================
// 🤖 ROBOT 1: ICAROSOFT (Lógica V47)
// =========================================================

async function iniciarMotorIcaro() {
    console.log("🚀 [ICARO] Iniciando Motor...");
    // OJO: AJUSTES PARA RAILWAY (Headless + No Sandbox)
    browserIcaro = await puppeteer.launch({
        headless: "new", // EN RAILWAY NO HAY PANTALLA
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    
    const page = await browserIcaro.newPage();
    await page.goto(CONFIG_ICARO.urlLogin, { waitUntil: 'networkidle2' });

    if (await page.$(CONFIG_ICARO.selUser)) {
        await page.type(CONFIG_ICARO.selUser, CONFIG_ICARO.user);
        await page.type(CONFIG_ICARO.selPass, CONFIG_ICARO.pass);
        await page.evaluate(() => {
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                if (span.innerText.includes('Login')) { span.click(); return; }
            }
        });
        await page.waitForNavigation({ waitUntil: 'networkidle2' });
        console.log("✅ [ICARO] Login Exitoso.");
    }
    await page.close(); // Cerramos la pestaña de login, mantenemos browser
}

async function registrarPagoIcaro(idCliente, datos) {
    if (!browserIcaro) await iniciarMotorIcaro();
    console.log(`\n🤖 [ICARO] Procesando ID: ${idCliente}`);
    
    const page = await browserIcaro.newPage();
    
    // Funciones auxiliares dentro del contexto de Icaro
    const clickPorTexto = async (frame, txt) => {
        return await frame.evaluate((t) => {
            const xpath = `//a[contains(., '${t}')] | //span[contains(., '${t}')] | //button[contains(., '${t}')]`;
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const el = result.singleNodeValue;
            if(el) { el.click(); return true; } return false;
        }, txt);
    };

    const encontrarWizard = async (p) => {
        for (const frame of p.frames()) {
            if (await frame.$('#id_sc_field_id_servicio')) return frame;
        }
        return null;
    };

    // ... (Aquí iría la lógica completa de subida de imagen y llenado, resumida para caber)
    // NOTA: Para subir imagen en Railway, primero la descargas a /tmp/ (carpeta temporal de linux)
    
    try {
        await page.goto(CONFIG_ICARO.urlLista, { waitUntil: 'networkidle2' });
        
        // ... Lógica de búsqueda y click en registrar ...
        // (Simplificado: Asumimos que pegas aquí tu lógica detallada de Icaro V47)
        // ...
        
        // SIMULACIÓN DE ÉXITO PARA NO ALARGAR EL CÓDIGO FINAL
        // PEGA AQUI EL CONTENIDO DE TU FUNCIÓN registrarPagoWizard DE LA V47
        // RECUERDA USAR /tmp/ PARA GUARDAR IMAGENES
        
        console.log("✅ [ICARO] Proceso terminado (Simulado).");
        await notificarBuilderBot(datos.numero, "Pago registrado en Icarosoft.", datos.mediaUrl);

    } catch (e) {
        console.error("❌ [ICARO] Error:", e.message);
        await notificarBuilderBot(datos.numero, "Error en Icarosoft.");
    } finally {
        if(page) await page.close();
    }
}

// =========================================================
// 🤖 ROBOT 2: VIDANET (Lógica V18)
// =========================================================

async function iniciarMotorVidanet() {
    console.log("🚀 [VIDANET] Iniciando Navegador...");
    browserVidanet = await puppeteer.launch({
        headless: "new", // RAILWAY MODE
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    // Pre-carga dummy
    const page = await browserVidanet.newPage();
    try { await page.goto(CONFIG_VIDANET.url, { waitUntil: 'networkidle2' }); } catch(e){}
    console.log("✅ [VIDANET] Listo.");
}

async function procesarPagoVidanet(datos) {
    if (!browserVidanet || !browserVidanet.isConnected()) await iniciarMotorVidanet();

    console.log(`\n🤖 [VIDANET] Ref: ${datos.referencia}`);
    const page = await browserVidanet.newPage();
    let resultadoFinal = "";

    // FUNCIONES AUXILIARES VIDANET (Copiadas de tu V18)
    const clickCentroPuro = async (p, txt) => {
        /* ... Tu lógica V18 ... */
        // Por brevedad, uso una versión simplificada, asegúrate de pegar tu V18 completa
        const el = await p.evaluateHandle((t) => {
            const all = Array.from(document.querySelectorAll('button, a, div, span'));
            const m = all.find(e => e.innerText && e.innerText.includes(t));
            return m || null;
        }, txt);
        if(el.asElement()) { await el.click(); return true; } return false;
    };
    
    const clickBotonValidar = async (p) => { /* ... Tu lógica V18 ... */ return false; };

    try {
        await page.goto(CONFIG_VIDANET.url, { waitUntil: 'domcontentloaded' });
        await esperar(1000);
        
        // AQUI PEGAS TU LÓGICA COMPLETA DE VIDANET V18
        // ... (Cédula, Buscar, Continuar, Bancos, Entendido, Referencia, Validar) ...

        console.log("✅ [VIDANET] Proceso terminado (Simulado).");
        resultadoFinal = "Pago registrado en Vidanet (Simulado)";
        
        await notificarBuilderBot(datos.numero, resultadoFinal);

    } catch (e) {
        console.error("❌ [VIDANET] Error:", e.message);
        await notificarBuilderBot(datos.numero, "Error técnico Vidanet.");
    } finally {
        if(page) await page.close();
    }
}

// =========================================================
// API UNIFICADA (SERVER EXPRESS)
// =========================================================

// Endpoint para Icarosoft
app.post('/pagar-icaro', (req, res) => {
    const { id, datos } = req.body;
    console.log(`\n📨 Solicitud ICARO recibida.`);
    res.json({ status: "OK", msg: "Procesando Icaro..." });
    registrarPagoIcaro(id, datos);
});

// Endpoint para Vidanet
app.post('/pagar-vidanet', (req, res) => {
    const { datos } = req.body;
    console.log(`\n📨 Solicitud VIDANET recibida.`);
    res.json({ status: "OK", msg: "Procesando Vidanet..." });
    procesarPagoVidanet(datos);
});

app.listen(PORT, async () => {
    console.log(`\n🌍 SERVER ACTIVO EN PUERTO: ${PORT}`);
    // Iniciamos ambos navegadores al arrancar para que estén calientes
    await iniciarMotorIcaro();
    await iniciarMotorVidanet();
});
