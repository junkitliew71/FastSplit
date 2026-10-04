const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-3.1-flash-lite'];

function doGet() {
  return jsonOutput({ status: 'ok', service: 'FastSplit Google receipt scanner' });
}

function doPost(event) {
  const started = Date.now();
  try {
    const request = JSON.parse(event.postData.contents || '{}');
    if (!request.imageBase64 || !/^image\/(jpeg|jpg|png|webp)$/i.test(request.mimeType || '')) {
      return jsonOutput({ error: { code: 'INVALID_IMAGE', message: 'A JPG, PNG, or WebP receipt image is required.' } });
    }
    const properties = PropertiesService.getScriptProperties();
    const result = scanWithFallback(request, properties);
    return jsonOutput(toFastSplitResponse(result.data, Date.now() - started, result.provider));
  } catch (error) {
    return jsonOutput({ error: { code: 'AI_OCR_ERROR', message: String(error.message || error) } });
  }
}

function scanWithFallback(request, properties) {
  const geminiKey = properties.getProperty('GEMINI_API_KEY');
  if (!geminiKey) throw new Error('Add GEMINI_API_KEY to Script Properties.');

  const configuredModels = properties.getProperty('GEMINI_MODELS');
  const legacyModel = properties.getProperty('GEMINI_MODEL');
  const models = configuredModels
    ? configuredModels.split(',').map(function(model) { return model.trim(); }).filter(Boolean)
    : (legacyModel ? [legacyModel].concat(DEFAULT_MODELS.filter(function(model) { return model !== legacyModel; })) : DEFAULT_MODELS);

  const failures = [];
  for (let index = 0; index < models.length; index += 1) {
    try {
      return { provider: models[index], data: scanWithGemini(request, geminiKey, models[index]) };
    } catch (error) {
      failures.push(models[index] + ': ' + String(error.message || error));
    }
  }
  throw new Error('Every configured free Gemini model failed. ' + failures.join(' | '));
}

function scanWithGemini(request, apiKey, model) {
  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
    + encodeURIComponent(model) + ':generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    contents: [{ role: 'user', parts: [
      { text: receiptPrompt() },
      { inline_data: { mime_type: request.mimeType, data: request.imageBase64 } },
    ] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json' },
  };
  const response = fetchJson(endpoint, payload, {});
  const text = response.candidates && response.candidates[0] && response.candidates[0].content.parts[0].text;
  if (!text) throw new Error('returned an empty receipt result');
  return parseAiJson(text);
}

function fetchJson(url, payload, headers) {
  const response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status < 200 || status >= 300) throw new Error('request failed (' + status + ')');
  return JSON.parse(body);
}

function parseAiJson(text) {
  const cleaned = String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(cleaned);
}

function receiptPrompt() {
  return [
    'Read this Malaysian receipt precisely. Never invent missing values.',
    'Return every visible useful text line with a bounding box [ymin,xmin,ymax,xmax] normalized 0-1000.',
    'Extract restaurant, items, quantity, unit price, item total, subtotal, service charge, SST/GST, discount, rounding and grand total.',
    'Use integer cents for all money values. Validate quantity * unitPriceCents approximately equals totalCents.',
    'If uncertain use null and needsReview true. Preserve multilingual Malay, English and Chinese item names.',
    'Return JSON with restaurant, confidence, needsReview, detections [{text, confidence, box}], items [{name, quantity, unitPriceCents, totalCents, confidence, needsReview}], and summary {subtotalCents, serviceChargeCents, taxCents, discountCents, roundingCents, grandTotalCents}.',
  ].join(' ');
}

function receiptSchema() {
  const nullableInteger = { type: 'INTEGER', nullable: true };
  return {
    type: 'OBJECT', required: ['restaurant', 'detections', 'items', 'summary', 'confidence', 'needsReview'],
    properties: {
      restaurant: { type: 'STRING', nullable: true }, confidence: { type: 'NUMBER' }, needsReview: { type: 'BOOLEAN' },
      detections: { type: 'ARRAY', items: { type: 'OBJECT', required: ['text', 'confidence', 'box'], properties: {
        text: { type: 'STRING' }, confidence: { type: 'NUMBER' }, box: { type: 'ARRAY', items: { type: 'INTEGER' } },
      } } },
      items: { type: 'ARRAY', items: { type: 'OBJECT', required: ['name', 'quantity', 'unitPriceCents', 'totalCents', 'confidence', 'needsReview'], properties: {
        name: { type: 'STRING' }, quantity: { type: 'NUMBER', nullable: true }, unitPriceCents: nullableInteger,
        totalCents: nullableInteger, confidence: { type: 'NUMBER' }, needsReview: { type: 'BOOLEAN' },
      } } },
      summary: { type: 'OBJECT', required: ['subtotalCents', 'serviceChargeCents', 'taxCents', 'discountCents', 'roundingCents', 'grandTotalCents'], properties: {
        subtotalCents: nullableInteger, serviceChargeCents: nullableInteger, taxCents: nullableInteger,
        discountCents: nullableInteger, roundingCents: nullableInteger, grandTotalCents: nullableInteger,
      } },
    },
  };
}

function toFastSplitResponse(data, elapsedMs, provider) {
  const confidence = Number(data.confidence) || 0;
  const needsReview = data.needsReview !== false;
  const detections = (data.detections || []).map(function(item, index) {
    const box = item.box.length === 4 ? item.box : [0, 0, 0, 0];
    const bbox = { x1: box[1] / 1000, y1: box[0] / 1000, x2: box[3] / 1000, y2: box[2] / 1000 };
    return { id: 'ocr_' + (index + 1), text: item.text, confidence: item.confidence, bbox: bbox,
      centerX: (bbox.x1 + bbox.x2) / 2, centerY: (bbox.y1 + bbox.y2) / 2 };
  });
  const items = (data.items || []).map(function(item, index) {
    const valid = item.quantity != null && item.unitPriceCents != null && item.totalCents != null
      ? Math.abs(item.quantity * item.unitPriceCents - item.totalCents) <= 1 : null;
    return { id: 'item_' + (index + 1), name: item.name, quantity: item.quantity, unitPriceCents: item.unitPriceCents,
      totalCents: item.totalCents, confidence: item.confidence, needsReview: item.needsReview || valid === false,
      mappings: { name: { ocrIds: [] }, quantity: { ocrIds: [] }, unitPrice: { ocrIds: [] }, total: { ocrIds: [] } } };
  });
  const itemSum = items.reduce(function(sum, item) { return sum + (item.totalCents || 0); }, 0);
  const summary = data.summary || {};
  const expected = (summary.subtotalCents == null ? itemSum : summary.subtotalCents)
    + (summary.serviceChargeCents || 0) + (summary.taxCents || 0) - Math.abs(summary.discountCents || 0) + (summary.roundingCents || 0);
  return {
    requestId: Utilities.getUuid(), image: { width: 0, height: 0, format: null },
    quality: { brightness: 0.5, contrast: 0.5, lowContrast: false, underexposed: false, overexposed: false },
    ocr: { passUsed: 1, secondPassReason: null, confidence: confidence, text: detections.map(function(x) { return x.text; }).join('\n'), detections: detections },
    parsed: {
      restaurantName: { value: data.restaurant || null, confidence: confidence, mapping: { ocrIds: [] } }, items: items,
      charges: { serviceChargeCents: summary.serviceChargeCents || 0, taxCents: summary.taxCents || 0,
        discountCents: summary.discountCents || 0, roundingCents: summary.roundingCents || 0, otherCents: 0, mappings: {} },
      totals: { itemSumCents: itemSum, subtotalCents: summary.subtotalCents, grandTotalCents: summary.grandTotalCents,
        mappings: { subtotal: { ocrIds: [] }, grandTotal: { ocrIds: [] } } },
      validation: { itemArithmeticValid: items.every(function(x) { return !x.needsReview; }),
        subtotalChecked: summary.subtotalCents != null, subtotalValid: summary.subtotalCents == null ? null : Math.abs(itemSum - summary.subtotalCents) <= 1,
        grandTotalChecked: summary.grandTotalCents != null, grandTotalValid: summary.grandTotalCents == null ? null : Math.abs(expected - summary.grandTotalCents) <= 1 },
      confidence: confidence, needsReview: needsReview,
    },
    timingsMs: { ai: elapsedMs, total: elapsedMs }, cacheHit: false, needsReview: needsReview,
    message: 'Scanned with ' + provider + '.', aiProvider: provider,
  };
}

function jsonOutput(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
