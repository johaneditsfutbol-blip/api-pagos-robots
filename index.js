const express = require('express');
const puppeteer = require('puppeteer');
const fs = require('fs');
const https = require('https');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// ==========================================
// 1. CONFIGURACIONES GLOBALES
// ==========================================

// Configuración ICAROSOFT
const CONFIG_ICARO = {
    urlLogin: "https://administrativo.icarosoft.com/",
    urlLista: "https://administrativo.icarosoft.com/Listado_clientes_tickets/",
    user: "JOHANC",
    pass: "@VNjohanc16",
    selUser: '#id_sc_field_login',
    selPass: '#id_sc_field_pswd',
};

// Configuración VIDANET
const CONFIG_VIDANET = { 
    url: "https://pagos.vidanet.net" 
};

// Configuración BUILDERBOT (Compartida)
const BUILDERBOT = {
    url: 'https://app.builderbot.cloud/api/v2/80c70b51-1737-4dad-9ee9-111cbc75174e/messages',
    token: 'bb-3441000d-f490-47bf-9c5a-273409fad976'
};

// --- VARIABLES DE ESTADO SEPARADAS ---
let browserIcaro = null;
let pageIcaroMain = null;

let browserVidanet = null;
let pageVidanetDummy = null;

const esperar = (ms) => new Promise(r => setTimeout(r, ms));

// ==========================================
// 2. HERRAMIENTA DE NOTIFICACIÓN (UNIFICADA)
// ==========================================
// Usamos la versión más completa (la del Registrador 1) que soporta imágenes.

function notificarBuilderBot(datos) {
    return new Promise((resolve, reject) => {
        console.log("   🔔 Preparando notificación a BuilderBot...");

        // Soporte para cuando viene solo el numero (Vidanet) o objeto completo (Icaro)
        const numero = datos.numero || datos; 
        
        if (!numero) {
            console.error("   ❌ ERROR: Falta 'numero' para BuilderBot.");
            resolve(null);
            return;
        }

        const mensajeTexto = datos.mensaje || (typeof datos === 'string' ? datos : "Proceso finalizado.");
        
        const mensajeObj = {
            "content": mensajeTexto
        };

        // Si viene mediaUrl (Icaro), lo agregamos
        if (datos.mediaUrl && datos.mediaUrl.startsWith('http')) {
            mensajeObj.mediaUrl = datos.mediaUrl;
        }

        // Formato OBJETO (Correcto)
        const payload = JSON.stringify({
            "number": String(numero).replace(/\D/g, ''),
            "messages": mensajeObj, 
            "checkIfExists": false
        });

        console.log(`   📦 Payload enviado: ${payload}`);

        const urlParts = new URL(BUILDERBOT.url);
        
        const options = {
            hostname: urlParts.hostname,
            path: urlParts.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-builderbot': BUILDERBOT.token,
                'Content-Length': Buffer.byteLength(payload)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    console.log(`   ✅ BuilderBot Éxito (${res.statusCode})`);
                } else {
                    console.log(`   ❌ BuilderBot Error (${res.statusCode}): ${data}`);
                }
                resolve(data);
            });
        });

        req.on('error', (e) => {
            console.error(`   ❌ Error conexión BuilderBot: ${e.message}`);
            resolve(null); 
        });

        req.write(payload);
        req.end();
    });
}

// ==========================================
// 3. BLOQUE ROBOT 1: ICAROSOFT
// ==========================================

function descargarImagenTemporal(url) {
    return new Promise((resolve, reject) => {
        const nombreTemp = `temp_comprobante_${Date.now()}.jpg`;
        const rutaTemp = path.resolve(__dirname, nombreTemp);
        const file = fs.createWriteStream(rutaTemp);
        console.log(`         -> ⬇️ Descargando imagen...`);
        https.get(url, (response) => {
            if (response.statusCode !== 200) { reject(new Error(`Error: ${response.statusCode}`)); return; }
            response.pipe(file);
            file.on('finish', () => file.close(() => resolve(rutaTemp)));
        }).on('error', (err) => { fs.unlink(rutaTemp, () => {}); reject(err); });
    });
}

async function subirComprobante(frame, rutaOUrl) {
    console.log(`         -> 📤 Procesando comprobante para Icarosoft...`);
    let rutaFinal = rutaOUrl;
    let esTemporal = false;

    if (rutaOUrl.startsWith('http')) {
        try { rutaFinal = await descargarImagenTemporal(rutaOUrl); esTemporal = true; } 
        catch (e) { console.log(`            ❌ Error descarga: ${e.message}`); return false; }
    } else if (!fs.existsSync(rutaFinal)) {
        console.log("            ❌ ERROR: Archivo local no existe."); return false;
    }

    const input = await frame.$('input[type="file"]');
    if (input) {
        await input.uploadFile(rutaFinal);
        console.log("            ✅ Archivo subido.");
        await frame.evaluate(() => {
            const el = document.querySelector('input[type="file"]');
            if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await esperar(5000); 
        if (esTemporal) try { fs.unlinkSync(rutaFinal); } catch(e){} 
        return true;
    }
    return false;
}

async function encontrarFrameDelWizard(page) {
    const frames = page.frames();
    for (const frame of frames) {
        if (await frame.$('#id_sc_field_id_servicio')) return frame;
    }
    return null;
}

async function clickPorTexto(frame, texto) {
    return await frame.evaluate((txt) => {
        const xpath = `//a[contains(., '${txt}')] | //span[contains(., '${txt}')] | //button[contains(., '${txt}')] | //div[contains(text(), '${txt}')]`;
        const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        const el = result.singleNodeValue;
        if (el) {
            el.scrollIntoView();
            el.click();
            return true;
        }
        return false;
    }, texto);
}

async function seleccionarComoServicio(frame, idExacto, textoBuscar) {
    console.log(`         -> Intentando seleccionar "${textoBuscar}" en #${idExacto}`);
    return await frame.evaluate((id, txt) => {
        const el = document.getElementById(id);
        if (!el) return { ok: false, msg: "ID no encontrado" };
        const normalizar = (s) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        const busqueda = normalizar(txt);
        const opcion = Array.from(el.options).find(opt => normalizar(opt.text).includes(busqueda));

        if (opcion) {
            el.click(); 
            el.value = opcion.value;
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return { ok: true, msg: "Seleccionado" };
        } else {
            const disponibles = Array.from(el.options).map(o => o.text).join(" | ");
            return { ok: false, msg: `Opción no encontrada. Disponibles: [${disponibles}]` };
        }
    }, idExacto, textoBuscar).then(res => {
        if (!res.ok) console.log(`            ⚠️ ${res.msg}`);
        return res.ok;
    });
}

async function escribirBlindado(page, frame, etiquetaVisual, valor) {
    console.log(`         -> 🛡️ Escribiendo "${valor}" en [${etiquetaVisual}]`);
    
    const idInput = await frame.evaluate((txt) => {
        let el = null;
        if (txt.includes("Monto")) el = document.querySelector('input[id*="monto"]');
        if (txt.includes("Referencia")) el = document.querySelector('input[id*="referencia"]');
        if (txt.includes("Fecha")) el = document.querySelector('input[id*="fecha"]');
        if (!el) {
            const xpath = `//tr[contains(., '${txt}')]//input[not(@type='hidden')]`;
            const result = document.evaluate(xpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            el = result.singleNodeValue;
        }
        return el ? el.id : null;
    }, etiquetaVisual);

    if (!idInput) {
        console.log(`            ❌ ERROR: Campo no encontrado.`);
        return false;
    }

    const selector = `#${idInput}`;

    try {
        await frame.click(selector); 
    } catch (e) {
        await frame.evaluate((id) => document.getElementById(id).focus(), idInput);
    }
    
    await frame.evaluate((id) => { const i = document.getElementById(id); if(i) i.focus(); }, idInput);

    try { await frame.click(selector, { clickCount: 3 }); } catch(e){}
    await page.keyboard.press('Backspace');
    await esperar(100);
    await page.keyboard.type(String(valor), { delay: 100 });
    
    await frame.evaluate(() => {
        const titulo = document.querySelector('.scFormHeader') || document.body;
        titulo.click(); 
    });
    
    console.log(`            ✅ Escrito.`);
    return true;
}

// INICIO MOTOR ICARO
async function iniciarSistemaIcaro() {
    console.log("🚀 [ICARO] Iniciando Motor...");
    // AJUSTE RAILWAY: Headless "new" + Args Linux
    browserIcaro = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] 
    });
    
    pageIcaroMain = await browserIcaro.newPage();
    await pageIcaroMain.goto(CONFIG_ICARO.urlLogin, { waitUntil: 'networkidle2' });

    if (await pageIcaroMain.$(CONFIG_ICARO.selUser)) {
        await pageIcaroMain.type(CONFIG_ICARO.selUser, CONFIG_ICARO.user);
        await pageIcaroMain.type(CONFIG_ICARO.selPass, CONFIG_ICARO.pass);
        await pageIcaroMain.evaluate(() => {
            const spans = document.querySelectorAll('span');
            for (const span of spans) {
                if (span.innerText.includes('Login')) { span.click(); return; }
            }
        });
        await pageIcaroMain.waitForNavigation({ waitUntil: 'networkidle2' });
        console.log("✅ [ICARO] Login Exitoso.");
    }
}

async function registrarPagoWizard(idCliente, datos) {
    if (!browserIcaro) { console.error("❌ Navegador Icaro no listo."); return; }
    console.log(`\n🤖 --- [ICARO] PAGO ID: ${idCliente} ---`);
    
    const page = await browserIcaro.newPage();

    page.on('dialog', async dialog => {
        console.log(`      👀 ALERTA: "${dialog.message()}" -> ACEPTADA.`);
        await dialog.accept(); 
    });

    try {
        await page.goto(CONFIG_ICARO.urlLista, { waitUntil: 'networkidle2' });
        const searchIn = '#SC_fast_search_top'; 
        if (await page.$(searchIn)) {
            await page.type(searchIn, idCliente);
            await page.click('#SC_fast_search_submit_top');
            await esperar(3000); 
        }

        console.log("   🟢 Click 'Registrar pago'...");
        const frames = page.frames();
        let btnEncontrado = false;
        for (const f of frames) {
            const btn = await f.$('a[id*="registrar_pagos"], span[id*="registrar_pagos"]');
            if (btn) { await btn.click(); btnEncontrado = true; break; }
        }
        if (!btnEncontrado) throw new Error("Botón verde no encontrado.");

        await esperar(5000); 
        let wFrame = await encontrarFrameDelWizard(page);
        if (!wFrame) { await esperar(3000); wFrame = await encontrarFrameDelWizard(page); }
        if (!wFrame) throw new Error("No se detectó el formulario.");

        // --- PASO 1: SELECCIÓN ESTRICTA POR DIRECCIÓN ---
        console.log(`   1️⃣ Paso 1: Buscando coincidencia exacta con: "${datos.direccion}"`);
        
        const resultadoSeleccion = await wFrame.evaluate((textoA_Buscar) => {
            const el = document.querySelector('#id_sc_field_id_servicio');
            if (!el) return { exito: false, msg: "Error interno: Select no encontrado" };

            // 1. Validar que se envió dirección
            if (!textoA_Buscar || textoA_Buscar.trim() === "") {
                return { exito: false, msg: "ABORTADO: No se envió el dato 'direccion' en la solicitud." };
            }

            // 2. Buscar coincidencia (CONTIENE EXACTO)
            let encontrado = false;
            for (let i = 0; i < el.options.length; i++) {
                // Verificamos si el texto de la opción CONTIENE el texto buscado
                if (el.options[i].text.includes(textoA_Buscar)) {
                    el.selectedIndex = i;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    el.dispatchEvent(new Event('blur', { bubbles: true }));
                    encontrado = true;
                    return { exito: true, opcion: el.options[i].text };
                }
            }

            // 3. Si llega aquí, es que no encontró nada
            return { exito: false, msg: `ABORTADO: Ninguna opción contiene "${textoA_Buscar}"` };

        }, datos.direccion);

        // SI FALLÓ, PARAMOS TODO AQUÍ
        if (!resultadoSeleccion.exito) {
            const errorMsg = `❌ ${resultadoSeleccion.msg}`;
            console.error(errorMsg);
            // Notificamos el error al WhatsApp y cerramos
            await notificarBuilderBot({ numero: datos.numero, mensaje: errorMsg });
            await page.close();
            return; // <--- SE ACABÓ, NO REGISTRA PAGO
        }

        console.log(`      ✅ Servicio Seleccionado: "${resultadoSeleccion.opcion}"`);
        await esperar(2000); 
        await clickPorTexto(wFrame, 'Próximo');
        await esperar(4000);

        // --- PASO 2 ---
        console.log("   2️⃣ Paso 2: Tipo y Forma");
        if (datos.tipoPago) await seleccionarComoServicio(wFrame, 'id_sc_field_tipo_pago', datos.tipoPago);
        await esperar(1500);
        if (datos.formaPago) await seleccionarComoServicio(wFrame, 'id_sc_field_forma_pago', datos.formaPago);
        await esperar(2000);
        await clickPorTexto(wFrame, 'Próximo');
        await esperar(3000);

        // --- PASO 3 ---
        console.log("   3️⃣ Paso 3: Datos Financieros");
        await escribirBlindado(page, wFrame, 'Monto', datos.monto);
        console.log("          🛑 CUARENTENA: Esperando 8s...");
        await esperar(8000); 
        await escribirBlindado(page, wFrame, 'Referencia', datos.referencia);
        await esperar(2000);
        if (datos.fecha) await escribirBlindado(page, wFrame, 'Fecha', datos.fecha);

        await esperar(1000);
        await clickPorTexto(wFrame, 'Próximo');
        await esperar(3000);

        // --- PASO 4 ---
        console.log("   4️⃣ Paso 4: Imagen");
        if (datos.rutaImagen) {
            await subirComprobante(wFrame, datos.rutaImagen);
        }

        let fin = await clickPorTexto(wFrame, 'Agregar');
        if (!fin) fin = await clickPorTexto(wFrame, 'Finalizar');
        
        console.log("       CLICK FINAL REALIZADO.");
        await esperar(5000); 
        await page.close();

        // ===> WEBHOOK ÉXITO <===
        console.log("   ✨ Notificando a BuilderBot...");
        await notificarBuilderBot(datos);

    } catch (e) {
        console.error("❌ ERROR EN SEGUNDO PLANO ICARO:", e.message);
        await notificarBuilderBot({ numero: datos.numero, mensaje: `Error técnico: ${e.message}` });
        if(page && !page.isClosed()) await page.close();
    }
}

// ==========================================
// 4. BLOQUE ROBOT 2: VIDANET (V18 Francotirador)
// ==========================================

async function clickGeometrico(page, texto) {
    console.log(`      -> 📐 Buscando barra ancha: "${texto}"...`);
    const elemento = await page.evaluateHandle((txt) => {
        const norm = (s) => s ? s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
        const target = norm(txt);
        const all = Array.from(document.querySelectorAll('button, a, div, span'));
        const matches = all.filter(el => norm(el.innerText).includes(target) && el.offsetParent !== null);
        
        if (matches.length > 0) {
            matches.sort((a, b) => a.innerText.length - b.innerText.length);
            const ganador = matches[0];
            ganador.style.border = "5px solid #00FF00"; 
            ganador.scrollIntoView({block: "center"});
            return ganador;
        }
        return null;
    }, texto);

    if (!elemento.asElement()) return false;
    const box = await elemento.boundingBox();
    if (!box) return false;

    let clickX = box.x + box.width / 2;
    if (box.width > 300) {
        console.log("      📐 Ajustando click a la DERECHA.");
        clickX = box.x + box.width - 80; 
    }
    const clickY = box.y + box.height / 2;

    console.log(`      🖱️ Click Físico en X:${clickX} Y:${clickY}`);
    await page.mouse.click(clickX, clickY);
    return true;
}

async function clickCentroPuro(page, texto) {
    console.log(`      -> 🎯 Buscando botón normal: "${texto}"...`);
    const elemento = await page.evaluateHandle((txt) => {
        const norm = (s) => s ? s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
        const target = norm(txt);
        const all = Array.from(document.querySelectorAll('button, a, div, span, strong')); 
        const matches = all.filter(el => norm(el.innerText).includes(target) && el.offsetParent !== null);
        
        if (matches.length > 0) {
            matches.sort((a, b) => a.innerText.length - b.innerText.length);
            const ganador = matches[0];
            ganador.style.border = "5px solid #FF0000"; 
            ganador.scrollIntoView({block: "center"});
            return ganador;
        }
        return null;
    }, texto);

    if (!elemento.asElement()) return false;
    const box = await elemento.boundingBox();
    if (!box) return false;

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
}

async function clickBotonValidar(page) {
    console.log(`      -> 🛡️ Buscando EXCLUSIVAMENTE botón Validar...`);
    
    const elemento = await page.evaluateHandle(() => {
        const all = Array.from(document.querySelectorAll('button, div, span, a'));
        const matches = all.filter(el => {
            const texto = el.innerText ? el.innerText.toLowerCase() : "";
            const tieneInput = el.querySelector('input'); 
            const esVisible = el.offsetParent !== null;
            return texto.includes("validar") && !tieneInput && esVisible;
        });

        if (matches.length > 0) {
            matches.sort((a, b) => a.innerText.length - b.innerText.length);
            const ganador = matches[0];
            ganador.style.border = "6px solid #FF0000"; 
            ganador.style.backgroundColor = "yellow";
            ganador.scrollIntoView({block: "center"});
            return ganador;
        }
        return null;
    });

    if (!elemento.asElement()) return false;
    
    const box = await elemento.boundingBox();
    if (!box) return false;

    console.log(`      🖱️ Click Validar en X:${box.x + box.width / 2} Y:${box.y + box.height / 2}`);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
}

async function seleccionarLetra(page, letra) {
    return await page.evaluate((txt) => {
        const selects = Array.from(document.querySelectorAll('select'));
        const targetSelect = selects.find(sel => Array.from(sel.options).some(opt => opt.text.includes(txt)));
        if (targetSelect) {
            const option = Array.from(targetSelect.options).find(opt => opt.text.includes(txt));
            targetSelect.value = option.value;
            targetSelect.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
        return false;
    }, letra);
}

// INICIO MOTOR VIDANET
async function iniciarSistemaVidanet() {
    console.log("🚀 [VIDANET] Iniciando Motor...");
    // AJUSTE RAILWAY: Headless "new" + Args Linux
    browserVidanet = await puppeteer.launch({ 
        headless: "new", 
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'] 
    });
    
    pageVidanetDummy = await browserVidanet.newPage();
    try { await pageVidanetDummy.goto(CONFIG_VIDANET.url, { waitUntil: 'networkidle2' }); } catch(e){}
    console.log("✅ [VIDANET] Listo.");
}

// LÓGICA VIDANET
async function procesarPagoVidanet(datos) {
    if (!browserVidanet || !browserVidanet.isConnected()) await iniciarSistemaVidanet();

    console.log(`\n🤖 --- [VIDANET] PROCESO REF: ${datos.referencia} ---`);
    const page = await browserVidanet.newPage();
    let resultadoFinal = "";

    try {
        await page.goto(CONFIG_VIDANET.url, { waitUntil: 'domcontentloaded' }); 
        await esperar(1000);

        // 1. Cédula
        await seleccionarLetra(page, datos.letra); 
        const inputCedula = await page.$('input[type="text"], input[type="number"]');
        if (inputCedula) {
            await inputCedula.click({ clickCount: 3 });
            await inputCedula.type(datos.cedula, { delay: 100 });
            await page.keyboard.press('Enter');
        }
        
        console.log("      ⏳ Esperando lista...");
        try {
            await page.waitForFunction(() => document.body.innerText.includes('Continuar'), { timeout: 8000 });
        } catch(e) { throw new Error("No cargó la lista."); }
        await esperar(2000);

        // 3. CONTINUAR
        const continuo = await clickGeometrico(page, "Continuar");
        if (!continuo) throw new Error("Falla al clickear Continuar.");

        // 4. BANCOS
        console.log("      ⏳ Esperando bancos...");
        try {
            await page.waitForFunction(() => document.body.innerText.includes('Banco'), { timeout: 8000 });
        } catch(e) { 
            console.log("      ⚠️ Reintentando Continuar...");
            await clickGeometrico(page, "Continuar");
            await esperar(2000);
        }

        // 5. ELEGIR BANCO
        const bancoKey = datos.banco.includes("Venezuela") ? "Venezuela" : "Credito";
        const clickBanco = await clickCentroPuro(page, bancoKey);
        if (!clickBanco) throw new Error(`Banco no clickeado: ${datos.banco}`);
        await esperar(2000);

        // 6. ENTENDIDO
        const clickEntendido = await clickCentroPuro(page, "Entendido");
        if (!clickEntendido) throw new Error("Botón Entendido no clickeado.");
        await esperar(1500);

        // 7. REFERENCIA
        const inputRef = await page.$('input[placeholder*="Referencia"], input[placeholder*="referencia"]');
        if(inputRef) {
            await inputRef.click({clickCount: 3});
            await inputRef.type(datos.referencia, { delay: 100 });
        } else {
            const inputs = await page.$$('input[type="text"]');
            if(inputs.length > 0) {
                await inputs[inputs.length - 1].click();
                await inputs[inputs.length - 1].type(datos.referencia, {delay: 100});
            }
        }
        
        // ===> 8. VALIDAR (NUEVA LÓGICA V18) <===
        console.log("      ⏳ Esperando 1s...");
        await esperar(1000); 
        
        const clickHecho = await clickBotonValidar(page);
        
        if (!clickHecho) {
            console.log("      ⚠️ Falló click Validar. Usando ENTER de emergencia...");
            await page.keyboard.press('Enter');
        }
        
        console.log("      ⏳ Validando (Esperando 8s)...");
        await esperar(8000); 

        // 9. LEER RESULTADO
        const textoPantalla = await page.evaluate(() => document.body.innerText);

        if (textoPantalla.includes("Referencia no encontrada")) {
            console.log("      ❌ Referencia NO encontrada.");
            resultadoFinal = `Hola, Vidanet indica: Referencia no encontrada. Verifica los datos.`;
        } 
        else if (textoPantalla.includes("Detalle de la Transacción") || textoPantalla.includes("Resumen del Pago")) {
            console.log("      ✅ Éxito: Transacción detectada.");
            resultadoFinal = `¡Pago registrado exitosamente en Vidanet! Ref: ${datos.referencia}`;
        } 
        else {
            console.log("      ⚠️ Resultado ambiguo.");
            resultadoFinal = `Proceso finalizado. Verifica saldo. Ref: ${datos.referencia}`;
        }

        await esperar(3000); 
        await page.close();
        
        // Notificación usando la función compartida
        await notificarBuilderBot({ numero: datos.numero, mensaje: resultadoFinal });

    } catch (e) {
        console.error("❌ ERROR VIDANET:", e.message);
        await notificarBuilderBot({ numero: datos.numero, mensaje: "Error técnico Vidanet." });
    }
}

// ==========================================
// 5. API EXPRESS (RUTAS)
// ==========================================

// Endpoint Icarosoft (Mantenemos ruta original /pagar)
app.post('/pagar', (req, res) => {
    const { id, datos } = req.body;
    if (!id || !datos) return res.status(400).json({ error: "Faltan datos" });

    console.log(`\n📨 Solicitud ICARO recibida ID: ${id}.`);
    res.json({ status: "OK", message: "Procesando Icaro..." });
    registrarPagoWizard(id, datos);
});

// Endpoint Vidanet (Ruta nueva /pagar-vidanet)
app.post('/pagar-vidanet', (req, res) => {
    const { datos } = req.body;
    if (!datos) return res.status(400).json({ error: "Faltan datos" });

    console.log(`\n📨 Solicitud VIDANET recibida.`);
    res.json({ status: "OK", message: "Procesando Vidanet..." });
    procesarPagoVidanet(datos);
});

// Endpoint de prueba
app.get('/', (req, res) => {
    res.send("🤖 MegaRobot Activo (Icarosoft + Vidanet)");
});

app.listen(PORT, async () => {
    console.log(`\n🌍 SERVIDOR UNIFICADO ACTIVO EN PUERTO: ${PORT}`);
    // Iniciamos ambos motores al arrancar el servidor
    await iniciarSistemaIcaro();
    await iniciarSistemaVidanet();
});
