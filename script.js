// Elementos del DOM
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const btnStart = document.getElementById('btnStart');
const btnCapture = document.getElementById('btnCapture');
const btnStop = document.getElementById('btnStop');
const fileInput = document.getElementById('fileInput');
const ocrProgressWrap = document.getElementById('ocrProgressWrap');
const ocrProgressBar = document.getElementById('ocrProgressBar');
const textoDetectado = document.getElementById('textoDetectado');
const ocrLoading = document.getElementById('ocrLoading');
const flashOverlay = document.getElementById('flashOverlay');

let stream = null;

// Ocultar mensaje de carga inicial
ocrLoading.style.display = 'none';

// Efecto de flash al capturar
function triggerFlash() {
  flashOverlay.classList.add('active');
  setTimeout(() => {
    flashOverlay.classList.remove('active');
  }, 300);
}

// Sonido de captura (opcional)
function playShutterSound() {
  // Crear un sonido de captura simple usando Web Audio API
  try {
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(400, audioContext.currentTime + 0.1);
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.2);
  } catch (e) {
    // Si no funciona el audio, no pasa nada
  }
}

// Funciones de progreso
const showProgress = () => {
  ocrProgressWrap.classList.remove('d-none');
  ocrProgressBar.style.width = '100%';
  ocrProgressBar.textContent = 'Procesando...';
  ocrProgressBar.classList.add('progress-bar-animated');
};

const hideProgress = () => {
  ocrProgressWrap.classList.add('d-none');
  ocrProgressBar.style.width = '0%';
  ocrProgressBar.textContent = '';
  ocrProgressBar.classList.remove('progress-bar-animated');
};

// Iniciar cámara
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Tu navegador no permite acceso a la cámara. Usa la opción "Subir foto".');
    return;
  }

  try {
    btnStart.textContent = 'Conectando...';
    btnStart.disabled = true;

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;
    await video.play();
    
    btnCapture.disabled = false;
    btnCapture.classList.remove('processing');
    btnStop.disabled = false;
    btnStart.textContent = '✅ Cámara Activa';
    btnStart.disabled = true;
    console.log('Cámara iniciada correctamente');

  } catch (err) {
    console.error('Error:', err);
    btnStart.disabled = false;
    btnStart.textContent = 'Activar';
    alert('No se pudo acceder a la cámara. Verifica los permisos.');
  }
}

// Detener cámara
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  
  video.srcObject = null;
  btnCapture.disabled = true;
  btnCapture.classList.remove('processing');
  btnStop.disabled = true;
  btnStart.disabled = false;
  btnStart.textContent = 'Activar';
}

// Capturar imagen del video
function captureImage() {
  const videoWidth = video.videoWidth || 1280;
  const videoHeight = video.videoHeight || 720;
  
  canvas.width = videoWidth;
  canvas.height = videoHeight;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
  
  return canvas.toDataURL('image/jpeg', 0.9);
}

// Convertir imagen a Base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Procesar OCR usando API gratuita
async function processOCR(imageData) {
  try {
    showProgress();
    console.log('Iniciando OCR...');

    // Convertir data URL a blob
    const response = await fetch(imageData);
    const blob = await response.blob();
    
    // Crear FormData para la API
    const formData = new FormData();
    formData.append('file', blob, 'image.jpg');
    formData.append('language', 'spa');
    formData.append('isOverlayRequired', 'false');
    formData.append('detectOrientation', 'false');
    formData.append('scale', 'true');
    formData.append('OCREngine', '2');

    // Llamar a la API de OCR.space (gratuita)
    const ocrResponse = await fetch('https://api.ocr.space/parse/image', {
      method: 'POST',
      headers: {
        'apikey': 'helloworld' // API key gratuita pública
      },
      body: formData
    });

    if (!ocrResponse.ok) {
      throw new Error('Error en la API OCR');
    }

    const result = await ocrResponse.json();
    console.log('Respuesta OCR:', result);

    hideProgress();

let cleanText = '';
if (result.ParsedResults && result.ParsedResults.length > 0) {
  cleanText = (result.ParsedResults[0].ParsedText || '').trim();
}

  if (!cleanText) {
    textoDetectado.textContent = 'No se detectó texto en la imagen.';
  } else {
    // Mostrar texto detectado para debug
    console.log('Texto OCR detectado:', cleanText);
    console.log('Texto normalizado:', normalizarTexto(cleanText));
    
    // 🔮 Paso IA: pedir SOLO la variedad detectada
    textoDetectado.textContent = 'Detectando variedad…';
    const inferencia = await detectarVariedadIA(cleanText);

    if (inferencia && inferencia.variedad) {
      // Muestra la variedad con información adicional
      let resultado = `VARIEDAD DETECTADA:\n${inferencia.variedad}`;
      
      if (inferencia.cultivo) {
        resultado += `\n\nCULTIVO:\n${inferencia.cultivo}`;
      }
      
      if (inferencia.cliente) {
        resultado += `\n\nCLIENTE:\n${inferencia.cliente}`;
      }
      
      if (inferencia.conf) {
        resultado += `\n\nConfianza: ${Math.round(inferencia.conf * 100)}%`;
      }
      
      if (inferencia.evidencia) {
        resultado += `\n\nEvidencia: ${inferencia.evidencia}`;
      }
      
      textoDetectado.textContent = resultado;
      
      // Log completo en consola
      console.log('Oferta detectada:', {
        variedad: inferencia.variedad,
        cultivo: inferencia.cultivo,
        cliente: inferencia.cliente,
        conf: inferencia.conf,
        evidencia: inferencia.evidencia
      });
    } else {
      // Fallback con más información
      textoDetectado.textContent = `❌ No se pudo detectar oferta.\n\n📝 Texto detectado:\n${cleanText}\n\n💡 Intenta con mejor iluminación o enfoque.`;
      console.log('No se pudo detectar oferta para el texto:', cleanText);
    }
  }

// Mostrar modal
const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
modal.show();


  } catch (error) {
    hideProgress();
    console.error('Error OCR:', error);
    
    // Fallback: usar OCR local simple
    try {
      await processOCRLocal(imageData);
    } catch (fallbackError) {
      console.error('Fallback falló:', fallbackError);
      textoDetectado.textContent = 'Error procesando la imagen. Intenta con mejor iluminación.';
      const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
      modal.show();
    }
  }
}

// OCR local como fallback usando Canvas y análisis básico
async function processOCRLocal(imageData) {
  // Crear una imagen temporal para análisis
  const img = new Image();
  img.src = imageData;
  
  await new Promise(resolve => {
    img.onload = resolve;
  });
  
  // Crear canvas temporal para procesamiento
  const tempCanvas = document.createElement('canvas');
  const tempCtx = tempCanvas.getContext('2d');
  
  tempCanvas.width = img.width;
  tempCanvas.height = img.height;
  
  // Aplicar filtros para mejorar contraste
  tempCtx.filter = 'contrast(150%) brightness(110%)';
  tempCtx.drawImage(img, 0, 0);
  
  // Mostrar mensaje explicativo
  textoDetectado.textContent = 'Imagen capturada correctamente. Para mejor reconocimiento de texto, asegúrate de que:\n\n• El texto esté bien iluminado\n• La imagen esté enfocada\n• El texto sea lo suficientemente grande\n• No haya reflejos o sombras\n\nIntenta usar la API online cuando tengas conexión a internet.';
  
  const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
  modal.show();
}

// Event Listeners
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);

btnCapture.addEventListener('click', async () => {
  try {
    // Efectos visuales inmediatos
    triggerFlash();
    playShutterSound();

    btnCapture.classList.add('processing');
    btnCapture.setAttribute('aria-busy', 'true');
    btnCapture.disabled = true;

    // Loader animado (círculo girando)
    btnCapture.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';

    // Capturar imagen inmediatamente
    const imageData = captureImage();
    console.log('Imagen capturada, procesando OCR...');

    // Procesar OCR
    await processOCR(imageData);

  } catch (error) {
    console.error('Error:', error);
    alert('Error al capturar la imagen');
  } finally {
    btnCapture.classList.remove('processing');
    btnCapture.removeAttribute('aria-busy');
    btnCapture.disabled = false;

    // Volver al icono de cámara
    btnCapture.innerHTML = '<i class="ri-camera-line"></i>';
  }
});


fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  
  try {
    console.log('Procesando archivo:', file.name);
    const imageData = await fileToBase64(file);
    await processOCR(imageData);
  } catch (error) {
    console.error('Error:', error);
    alert('Error procesando el archivo');
  } finally {
    fileInput.value = '';
  }
});

// Botón copiar
document.getElementById('btnCopiar').addEventListener('click', async () => {
  try {
    const text = textoDetectado.textContent || '';
    await navigator.clipboard.writeText(text);
    
    const btn = document.getElementById('btnCopiar');
    const originalText = btn.textContent;
    btn.textContent = '¡Copiado!';
    
    setTimeout(() => {
      btn.textContent = originalText;
    }, 1500);
    
  } catch (error) {
    console.error('Error copiando:', error);
    alert('No se pudo copiar al portapapeles');
  }
});

// Limpiar recursos al cerrar
window.addEventListener('beforeunload', () => {
  stopCamera();
});
// --- UTILIDADES ---
function normalizarTexto(s) {
  if (!s) return '';
  const sinTildes = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return sinTildes
    .toUpperCase()
    .replace(/[•·•·•·]/g, ' ')
    .replace(/[^\w\s\-\+\/x]/g, ' ')   // conserva -, +, / y 'x' (variedad)
    .replace(/\s+/g, ' ')
    .trim();
}

// Llama a la IA (vía PHP) para detectar la variedad más probable.
// Devuelve { variedad: string, conf: number, evidencia?: string } o null si falla.
async function detectarVariedadIA(ocrText) {
  try {
    const resp = await fetch('php/detectar_variedades.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ocr_text: ocrText,
        ocr_text_normalizado: normalizarTexto(ocrText)
      })
    });
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const data = await resp.json();
    if (data && data.success && data.variedad) {
      return {
        variedad: data.variedad,
        cultivo: data.cultivo || '',
        cliente: data.cliente || '',
        conf: typeof data.conf === 'number' ? data.conf : null,
        evidencia: data.evidencia || ''
      };
    }
    return null;
  } catch (e) {
    console.warn('detectarVariedadIA fallo:', e);
    console.log('Texto OCR que causó el error:', ocrText);
    return null;
  }
}

console.log('Script cargado correctamente - Listo para usar');