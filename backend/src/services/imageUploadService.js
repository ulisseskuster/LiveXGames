const crypto = require('crypto');

const MAX_BASE64_LENGTH = 7_000_000; // ~5MB de imagem antes do overhead do base64
const HTTP_URL_PATTERN = /^https?:\/\//i;
const IMAGE_DATA_URI_PATTERN = /^data:image\/(png|jpe?g|gif|webp|avif);base64,/i;

class ImageUploadService {
  /**
   * Aceita apenas URLs http(s) ou data URIs de imagem em formatos conhecidos,
   * rejeitando esquemas perigosos (javascript:, data:text/html, etc.) e payloads
   * excessivamente grandes antes de repassar o conteúdo à Cloudinary.
   */
  static isValidImageInput(imageInput) {
    if (!imageInput || typeof imageInput !== 'string') return false;

    if (IMAGE_DATA_URI_PATTERN.test(imageInput)) {
      return process.env.NODE_ENV !== 'production' && imageInput.length <= MAX_BASE64_LENGTH;
    }

    // Antes bastava começar com http(s): o resto da string não era olhado, então
    // aspas e espaços passavam direto para dentro do atributo src do catálogo.
    // Agora a URL é parseada de verdade — se o construtor não aceita, não entra.
    if (!HTTP_URL_PATTERN.test(imageInput)) return false;
    try {
      const url = new URL(imageInput);
      if (process.env.NODE_ENV === 'production' && url.hostname !== 'res.cloudinary.com') {
        return false;
      }
      return (url.protocol === 'http:' || url.protocol === 'https:') && Boolean(url.hostname);
    } catch (e) {
      return false;
    }
  }
  /**
   * Extrai credenciais do Cloudinary a partir de CLOUDINARY_URL ou variáveis individuais
   */
  static getCloudinaryConfig() {
    if (process.env.CLOUDINARY_URL) {
      // Formato: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
      try {
        const parsed = new URL(process.env.CLOUDINARY_URL);
        return {
          apiKey: parsed.username,
          apiSecret: parsed.password,
          cloudName: parsed.hostname
        };
      } catch (e) {
        console.warn('[ImageUploadService] Falha ao parsear CLOUDINARY_URL:', e.message);
      }
    }

    if (
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    ) {
      return {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        apiSecret: process.env.CLOUDINARY_API_SECRET
      };
    }

    return null;
  }

  /**
   * Processa e hospeda uma imagem na nuvem Cloudinary de forma 100% automatizada.
   * Se Cloudinary não estiver configurado, retorna a URL original ou Base64 com segurança.
   * @param {string} imageInput - Base64 (data:image/...), URL externa ou caminho
   * @param {string} folder - Pasta de destino no Cloudinary (ex: 'livex_rewards')
   */
  static async uploadImage(imageInput, folder = 'livex_rewards') {
    if (!imageInput || typeof imageInput !== 'string') {
      return imageInput;
    }

    const config = this.getCloudinaryConfig();

    // Se não há Cloudinary configurado ou a imagem já é uma URL remota válida
    if (!config) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('IMAGE_STORAGE_NOT_CONFIGURED');
      }
      return imageInput;
    }

    // Se já é uma URL Cloudinary, não precisa reenviar
    if (imageInput.includes('res.cloudinary.com')) {
      return imageInput;
    }

    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
      const signature = crypto
        .createHash('sha1')
        .update(paramsToSign + config.apiSecret)
        .digest('hex');

      const formData = new FormData();
      formData.append('file', imageInput);
      formData.append('api_key', config.apiKey);
      formData.append('timestamp', timestamp.toString());
      formData.append('folder', folder);
      formData.append('signature', signature);

      const endpoint = `https://api.cloudinary.com/v1_1/${config.cloudName}/image/upload`;
      const response = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn(
          `[ImageUploadService] Cloudinary upload falhou (${response.status}): ${errText}`
        );
        if (process.env.NODE_ENV === 'production') throw new Error('IMAGE_UPLOAD_FAILED');
        return imageInput;
      }

      const result = await response.json();
      console.log(
        `[ImageUploadService] Imagem enviada para Cloudinary com sucesso: ${result.secure_url}`
      );
      return result.secure_url;
    } catch (err) {
      console.warn('[ImageUploadService] Erro ao enviar imagem para Cloudinary:', err.message);
      if (process.env.NODE_ENV === 'production') {
        throw new Error('IMAGE_UPLOAD_FAILED', { cause: err });
      }
      return imageInput;
    }
  }
}

module.exports = ImageUploadService;
