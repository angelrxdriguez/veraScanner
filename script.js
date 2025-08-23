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
const ocrLoadPct = document.getElementById('ocrLoadPct');

let stream = null;
let worker = null;
let isOCRReady = false;

// Funciones de progreso
const showProgress = (p) => {
  ocrProgressWrap.classList.remove('d-none');
  const pct = Math.round((p || 0) * 100);
  ocrProgressBar.style.width = pct + '%';
  ocrProgressBar.textContent = pct + '%';
};

const hideProgress = () => {
  ocrProgressWrap.classList.add('d-none');
  ocrProgressBar.style.width = '0%';
  ocrProgressBar.textContent = '';
};

// Normalizar texto
const normalizeText = (text) => {
  return text
    .replace(/[\t\r\n]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
};

// Inicializar OCR con configuración simple y confiable
async function initOCR() {
  try {
    console.log('Iniciando carga de OCR...');
    ocrLoading.textContent = 'Inicializando OCR...';
    ocrLoadPct.textContent = '0%';
    
    // Crear worker con configuración simple
    worker = await Tesseract.createWorker({
      logger: (m) => {
        console.log('OCR Status:', m.status, 'Progress:', m.progress);
        
        if (m.progress && typeof m.progress === 'number') {
          const progress = Math.round(m.progress * 100);
          ocrLoadPct.textContent = `${progress}%`;
          
          if (m.status === 'loading api') {
            ocrLoading.textContent = `Cargando API... ${progress}%`;
          } else if (m.status === 'initializing api') {
            ocrLoading.textContent = `Inicializando... ${progress}%`;
          } else if (m.status === 'loading language traineddata') {
            ocrLoading.textContent = `Cargando idioma... ${progress}%`;
          } else if (m.status === 'initializing tesseract') {
            ocrLoading.textContent = `Configurando OCR... ${progress}%`;
          }
        }
      }
    });

    // Cargar idioma español
    await worker.loadLanguage('spa');
    await worker.initialize('spa');

    console.log('Worker creado exitosamente');
    
    isOCRReady = true;
    ocrLoading.style.display = 'none';
    console.log('OCR listo para usar');
    
  } catch (error) {
    console.error('Error inicializando OCR:', error);
    
    // Intentar con inglés como fallback
    try {
      console.log('Intentando con inglés como fallback...');
      ocrLoading.textContent = 'Reintentando con inglés...';
      
      if (worker) {
        await worker.terminate();
      }
      
      worker = await Tesseract.createWorker({
        logger: (m) => {
          if (m.progress && typeof m.progress === 'number') {
            const progress = Math.round(m.progress * 100);
            ocrLoadPct.textContent = `${progress}%`;
            ocrLoading.textContent = `Fallback... ${progress}%`;
          }
        }
      });
      
      await worker.loadLanguage('eng');
      await worker.initialize('eng');
      
      isOCRReady = true;
      ocrLoading.style.display = 'none';
      console.log('OCR inicializado en inglés');
      
    } catch (fallbackError) {
      console.error('Error en fallback:', fallbackError);
      ocrLoading.innerHTML = '<span class="text-danger">❌ Error cargando OCR. Recarga la página.</span>';
    }
  }
}

// Iniciar cámara
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    alert('Tu navegador no permite acceso a la cámara. Usa la opción "Subir foto".');
    return;
  }

  try {
    btnStart.textContent = 'Conectando...';
    btnStart.disabled = true;

    const constraints = {
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280, min: 640 },
        height: { ideal: 720, min: 480 }
      },
      audio: false
    };

    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    
    video.onloadedmetadata = () => {
      video.play();
      btnCapture.disabled = false;
      btnStop.disabled = false;
      btnStart.textContent = '✅ Cámara activa';
      console.log('Cámara iniciada correctamente');
    };

  } catch (err) {
    console.error('Error accediendo a la cámara:', err);
    btnStart.disabled = false;
    btnStart.textContent = '🔓 Permitir cámara';
    
    let errorMsg = 'No se pudo acceder a la cámara.';
    if (err.name === 'NotAllowedError') {
      errorMsg = 'Permisos de cámara denegados. Permite el acceso en tu navegador.';
    } else if (err.name === 'NotFoundError') {
      errorMsg = 'No se encontró ninguna cámara en tu dispositivo.';
    } else if (err.name === 'NotSupportedError') {
      errorMsg = 'Tu navegador no soporta acceso a la cámara.';
    }
    
    alert(errorMsg + ' Usa la opción "Subir foto" como alternativa.');
  }
}

// Detener cámara
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach(track => {
      track.stop();
      console.log('Track detenido:', track.kind);
    });
    stream = null;
  }
  
  video.srcObject = null;
  btnCapture.disabled = true;
  btnStop.disabled = true;
  btnStart.disabled = false;
  btnStart.textContent = '🔓 Permitir cámara';
  console.log('Cámara detenida');
}

// Capturar imagen del video
function captureImageFromVideo() {
  return new Promise((resolve, reject) => {
    try {
      const videoWidth = video.videoWidth || 1280;
      const videoHeight = video.videoHeight || 720;
      
      canvas.width = videoWidth;
      canvas.height = videoHeight;
      
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
      
      canvas.toBlob((blob) => {
        if (blob) {
          console.log('Imagen capturada:', blob.size, 'bytes');
          resolve(blob);
        } else {
          reject(new Error('No se pudo crear la imagen'));
        }
      }, 'image/jpeg', 0.9);
      
    } catch (error) {
      reject(error);
    }
  });
}

// Procesar OCR
async function processOCR(imageBlob) {
  if (!isOCRReady || !worker) {
    alert('OCR aún no está listo. Espera un momento e intenta de nuevo.');
    return;
  }

  try {
    console.log('Iniciando reconocimiento OCR...');
    showProgress(0);

    const { data: { text, confidence } } = await worker.recognize(imageBlob, {
      logger: (m) => {
        if (m.status === 'recognizing text') {
          showProgress(m.progress);
        }
      }
    });

    hideProgress();
    
    const cleanText = normalizeText(text);
    const confidencePercent = Math.round(confidence);
    
    console.log('OCR completado:', { text: cleanText, confidence: confidencePercent });
    
    if (cleanText.length > 0) {
      textoDetectado.textContent = cleanText;
    } else {
      textoDetectado.textContent = 'No se detectó texto en la imagen. Intenta con mejor iluminación o acércate más al texto.';
    }
    
    // Mostrar modal
    const modal = new bootstrap.Modal(document.getElementById('resultadoModal'));
    modal.show();
    
  } catch (error) {
    hideProgress();
    console.error('Error en OCR:', error);
    alert('Error procesando la imagen: ' + error.message);
  }
}

// Event Listeners
btnStart.addEventListener('click', startCamera);
btnStop.addEventListener('click', stopCamera);

btnCapture.addEventListener('click', async () => {
  try {
    btnCapture.disabled = true;
    btnCapture.textContent = 'Procesando...';
    
    const imageBlob = await captureImageFromVideo();
    await processOCR(imageBlob);
    
  } catch (error) {
    console.error('Error capturando imagen:', error);
    alert('Error al capturar la imagen: ' + error.message);
  } finally {
    btnCapture.disabled = false;
    btnCapture.textContent = '📸 Capturar & OCR';
  }
});

fileInput.addEventListener('change', async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  
  try {
    console.log('Procesando archivo:', file.name, file.size, 'bytes');
    await processOCR(file);
  } catch (error) {
    console.error('Error procesando archivo:', error);
    alert('Error procesando el archivo: ' + error.message);
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
    btn.classList.add('btn-success');
    btn.classList.remove('btn-primary');
    
    setTimeout(() => {
      btn.textContent = originalText;
      btn.classList.remove('btn-success');
      btn.classList.add('btn-primary');
    }, 1500);
    
  } catch (error) {
    console.error('Error copiando texto:', error);
    alert('No se pudo copiar al portapapeles.');
  }
});

// Inicializar cuando la página esté lista
document.addEventListener('DOMContentLoaded', () => {
  console.log('Página cargada, inicializando OCR...');
  initOCR();
});

// Limpiar recursos al cerrar
window.addEventListener('beforeunload', () => {
  if (worker) {
    worker.terminate();
  }
  stopCamera();
});