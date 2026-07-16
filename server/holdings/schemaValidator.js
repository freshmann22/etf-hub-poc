// ETF 구성자산 스키마(형태) 검증기 — 외부 의존성 없음.
// schemas/etf-holdings.schema.json(draft 2020-12)을 node:fs 로 읽어
// 문서/개별 holding 의 "형태"만 검증한다.
// 비즈니스 규칙(비중 합계·중복 등)은 여기서 다루지 않는다(별도 businessValidator 소관).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// import.meta.url 기준으로 스키마 파일 경로 해석(리포지토리 이동에 견고).
const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(__dirname, '../../schemas/etf-holdings.schema.json');

const rootSchema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));

// 이 검증기가 실제로 해석하는 JSON-Schema 키워드의 전체 집합.
// 여기 없는 키워드(예: oneOf, allOf, anyOf, minimum, maximum, format …)는
// 조용히 무시되면 안 되고, checkSchemaSupport 로 명시적으로 드러낸다.
const SUPPORTED_KEYWORDS = new Set([
  '$schema',
  '$id',
  'title',
  'description',
  'type',
  'required',
  'enum',
  'pattern',
  'minLength',
  'additionalProperties',
  'properties',
  'items',
  '$ref',
  '$defs',
]);

// 스키마 노드를 재귀적으로 순회하며, 지원되지 않는 키워드를 수집한다.
// 스키마 "노드"인 위치(root, properties.*, items, $defs.*, 객체형 additionalProperties)
// 만 검사하고, enum/required 값이나 properties 키 이름은 키워드로 오인하지 않는다.
function collectUnsupported(node, found) {
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return;

  for (const key of Object.keys(node)) {
    if (!SUPPORTED_KEYWORDS.has(key)) found.add(key);
  }

  // properties: 값들이 각각 하위 스키마.
  if (node.properties && typeof node.properties === 'object') {
    for (const sub of Object.values(node.properties)) collectUnsupported(sub, found);
  }
  // $defs: 값들이 각각 하위 스키마.
  if (node.$defs && typeof node.$defs === 'object') {
    for (const sub of Object.values(node.$defs)) collectUnsupported(sub, found);
  }
  // items: 하위 스키마(단일).
  if (node.items !== undefined) collectUnsupported(node.items, found);
  // additionalProperties: boolean 이면 스킵, 객체(스키마)면 재귀.
  if (node.additionalProperties && typeof node.additionalProperties === 'object') {
    collectUnsupported(node.additionalProperties, found);
  }
}

// 스키마가 이 검증기의 지원 키워드 범위 안에 있는지 점검한다.
// 반환: { supported: boolean, unsupportedKeywords: string[] }(정렬·중복제거).
export function checkSchemaSupport(schema) {
  const found = new Set();
  collectUnsupported(schema, found);
  const unsupportedKeywords = [...found].sort();
  return { supported: unsupportedKeywords.length === 0, unsupportedKeywords };
}

// 모듈 로드 시 번들 스키마를 점검. 미지원 키워드가 있으면 조용히 무시하지 않고
// 명시적으로 드러낸다: 기본은 console.warn, HOLDINGS_SCHEMA_STRICT 설정 시 throw.
{
  const { supported, unsupportedKeywords } = checkSchemaSupport(rootSchema);
  if (!supported) {
    const msg =
      '지원하지 않는 JSON-Schema 키워드 감지: ' + unsupportedKeywords.join(', ');
    if (process.env.HOLDINGS_SCHEMA_STRICT) {
      throw new Error(msg);
    }
    console.warn('[schemaValidator] ' + msg);
  }
}

// JSON 경로 표기(에러 메시지용). 루트는 '$'.
function joinPath(path, key) {
  if (typeof key === 'number') return `${path}[${key}]`;
  return path === '$' ? `$.${key}` : `${path}.${key}`;
}

// 스키마가 사용하는 subset 만 지원:
// type(union 배열/integer 포함), required, enum, pattern, minLength,
// additionalProperties:false, array items, $ref(#/$defs/holding), properties.
function resolveRef(ref) {
  // 지원 범위: 로컬 포인터 "#/$defs/<name>" 만.
  if (typeof ref !== 'string' || !ref.startsWith('#/')) {
    throw new Error('지원하지 않는 $ref: ' + ref);
  }
  const parts = ref.slice(2).split('/');
  let node = rootSchema;
  for (const part of parts) {
    node = node?.[part];
    if (node === undefined) throw new Error('해석할 수 없는 $ref: ' + ref);
  }
  return node;
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value; // 'number'(정수 아님)/'string'/'boolean'/'object'
}

// 단일 JSON Schema type 토큰과 실제 값의 매칭 여부.
function matchesType(value, type) {
  switch (type) {
    case 'null':
      return value === null;
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    default:
      return false;
  }
}

function checkType(value, schemaType, path, errors) {
  const types = Array.isArray(schemaType) ? schemaType : [schemaType];
  if (!types.some((t) => matchesType(value, t))) {
    errors.push(
      `${path}: 타입이 올바르지 않음 (기대: ${types.join(' | ')}, 실제: ${typeName(value)})`,
    );
    return false;
  }
  return true;
}

// 하나의 스키마 노드에 대해 값을 검증(재귀).
function validateNode(value, schema, path, errors) {
  if (schema.$ref !== undefined) {
    validateNode(value, resolveRef(schema.$ref), path, errors);
    return;
  }

  // type
  if (schema.type !== undefined) {
    if (!checkType(value, schema.type, path, errors)) {
      // 타입이 틀리면 하위 제약 검사는 의미가 없어 중단.
      return;
    }
  }

  // enum
  if (schema.enum !== undefined) {
    const ok = schema.enum.some((allowed) => allowed === value);
    if (!ok) {
      errors.push(
        `${path}: 허용되지 않은 값 '${String(value)}' (enum: ${schema.enum.map((v) => String(v)).join(', ')})`,
      );
    }
  }

  // 문자열 제약: pattern, minLength
  if (typeof value === 'string') {
    if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
      errors.push(`${path}: 형식이 올바르지 않음 (pattern: ${schema.pattern})`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      errors.push(`${path}: 길이가 너무 짧음 (minLength: ${schema.minLength})`);
    }
  }

  // 객체 제약: required, properties, additionalProperties:false
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          errors.push(`${joinPath(path, key)}: 필수 항목 누락`);
        }
      }
    }
    const properties = schema.properties ?? {};
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`${joinPath(path, key)}: 허용되지 않은 속성`);
        }
      }
    }
    for (const [key, propSchema] of Object.entries(properties)) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        validateNode(value[key], propSchema, joinPath(path, key), errors);
      }
    }
  }

  // 배열 제약: items
  if (Array.isArray(value) && schema.items !== undefined) {
    value.forEach((item, index) => {
      validateNode(item, schema.items, joinPath(path, index), errors);
    });
  }
}

// 문서 전체를 스키마에 대해 검증한다.
export function validateHoldingsDocument(doc) {
  const errors = [];
  validateNode(doc, rootSchema, '$', errors);
  return { valid: errors.length === 0, errors };
}

// holdings[] 개별 항목을 #/$defs/holding 에 대해 검증한다.
export function validateHolding(holding) {
  const errors = [];
  validateNode(holding, rootSchema.$defs.holding, '$', errors);
  return { valid: errors.length === 0, errors };
}
