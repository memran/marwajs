import * as acorn from 'acorn';
import { generate } from 'astring';

type Node = any;

const JS_KEYWORDS = new Set([
  'true','false','null','undefined','NaN','Infinity',
  'if','else','for','while','do','switch','case','break','continue','return',
  'let','const','var','function','class','new','this','delete','typeof','void','yield','await',
  'import','export','default','extends','super','try','catch','finally','throw'
]);

const JS_GLOBALS = new Set([
  'globalThis','window','document','console','setTimeout','setInterval','queueMicrotask',
  'Math','Date','Number','String','Boolean','Array','Object','JSON','Intl','RegExp',
  'Map','Set','WeakMap','WeakSet','Symbol','BigInt','Promise','Reflect','Proxy',
  'Error','TypeError','URL','URLSearchParams','performance'
]);

/** Collect bound names from a pattern (identifiers in params/var decls). */
function collectPatternIds(pat: Node, out: Set<string>) {
  if (!pat) return;
  switch (pat.type) {
    case 'Identifier': out.add(pat.name); break;
    case 'RestElement': collectPatternIds(pat.argument, out); break;
    case 'AssignmentPattern': collectPatternIds(pat.left, out); break;
    case 'ArrayPattern': pat.elements?.forEach((e: Node) => e && collectPatternIds(e, out)); break;
    case 'ObjectPattern':
      pat.properties?.forEach((prop: Node) => {
        if (prop.type === 'Property') collectPatternIds(prop.value, out);
        else if (prop.type === 'RestElement') collectPatternIds(prop.argument, out);
      });
      break;
  }
}

/** Returns true if `name` is locally bound in any scope on the stack. */
function isLocal(name: string, scopes: Set<string>[]) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i].has(name)) return true;
  }
  return false;
}

/** Should this Identifier be prefixed with ctx.? */
function shouldCtxQualify(id: string, parent: Node | null, scopes: Set<string>[], extraLocals: Set<string>) {
  if (id === 'ctx') return false;
  if (JS_KEYWORDS.has(id)) return false;
  if (JS_GLOBALS.has(id)) return false;
  if (extraLocals.has(id)) return false;
  if (isLocal(id, scopes)) return false;

  // If used as non-computed property key: obj.id or { id: ... } key
  if (parent) {
    if (parent.type === 'MemberExpression' && parent.property && parent.property.type === 'Identifier' && parent.property.name === id && !parent.computed) {
      return false;
    }
    if (parent.type === 'Property' && parent.key && parent.key.type === 'Identifier' && parent.key.name === id && !parent.computed) {
      // key of { id: ... }
      return false;
    }
    // labels/exports/imports won't appear in pure expressions
  }
  return true;
}

/** Deep transform node, rewriting free Identifiers to MemberExpression(ctx, id). */
function rewriteNode(node: Node, scopes: Set<string>[], extraLocals: Set<string>, parent: Node | null = null): Node {
  if (!node) return node;

  switch (node.type) {
    // --- Scopes ---
    case 'Program': {
      const scope = new Set<string>();
      const body = node.body.map((stmt: Node) => rewriteNode(stmt, [...scopes, scope], extraLocals, node));
      return { ...node, body };
    }

    case 'FunctionDeclaration': {
      const scope = new Set<string>();
      if (node.id) scope.add(node.id.name);
      node.params.forEach((p: Node) => collectPatternIds(p, scope));
      const id = node.id ? rewriteNode(node.id, scopes, extraLocals, node) : null;
      const params = node.params.map((p: Node) => rewriteNode(p, [...scopes, scope], extraLocals, node));
      const body = rewriteNode(node.body, [...scopes, scope], extraLocals, node);
      return { ...node, id, params, body };
    }

    case 'FunctionExpression':
    case 'ArrowFunctionExpression': {
      const scope = new Set<string>();
      if (node.id) scope.add(node.id.name);
      node.params.forEach((p: Node) => collectPatternIds(p, scope));
      const id = node.id ? rewriteNode(node.id, scopes, extraLocals, node) : null;
      const params = node.params.map((p: Node) => rewriteNode(p, [...scopes, scope], extraLocals, node));
      const body = rewriteNode(node.body, [...scopes, scope], extraLocals, node);
      return { ...node, id, params, body };
    }

    case 'BlockStatement': {
      const scope = new Set<string>();
      const body = node.body.map((s: Node) => {
        // var/let/const/class/function declarations add to scope
        if (s.type === 'VariableDeclaration') {
          s.declarations.forEach((d: Node) => collectPatternIds(d.id, scope));
        }
        if (s.type === 'FunctionDeclaration' && s.id) scope.add(s.id.name);
        if (s.type === 'ClassDeclaration' && s.id) scope.add(s.id.name);
        return rewriteNode(s, [...scopes, scope], extraLocals, node);
      });
      return { ...node, body };
    }

    case 'VariableDeclaration': {
      const declarations = node.declarations.map((d: Node) => rewriteNode(d, scopes, extraLocals, node));
      return { ...node, declarations };
    }

    case 'VariableDeclarator': {
      const id = rewriteNode(node.id, scopes, extraLocals, node);
      const init = rewriteNode(node.init, scopes, extraLocals, node);
      return { ...node, id, init };
    }

    case 'ClassDeclaration': {
      const scope = new Set<string>();
      if (node.id) scope.add(node.id.name);
      const id = node.id ? rewriteNode(node.id, scopes, extraLocals, node) : null;
      const superClass = rewriteNode(node.superClass, [...scopes, scope], extraLocals, node);
      const body = rewriteNode(node.body, [...scopes, scope], extraLocals, node);
      return { ...node, id, superClass, body };
    }

    case 'CatchClause': {
      const scope = new Set<string>();
      if (node.param) collectPatternIds(node.param, scope);
      const param = node.param ? rewriteNode(node.param, [...scopes, scope], extraLocals, node) : null;
      const body = rewriteNode(node.body, [...scopes, scope], extraLocals, node);
      return { ...node, param, body };
    }

    // --- Expressions/Primitives ---
    case 'Identifier': {
      if (shouldCtxQualify(node.name, parent, scopes, extraLocals)) {
        return {
          type: 'MemberExpression',
          object: { type: 'Identifier', name: 'ctx' },
          property: { type: 'Identifier', name: node.name },
          computed: false,
          optional: false
        };
      }
      return node;
    }

    case 'MemberExpression': {
      const object = rewriteNode(node.object, scopes, extraLocals, node);
      const property = node.computed ? rewriteNode(node.property, scopes, extraLocals, node) : node.property;
      return { ...node, object, property };
    }

    case 'Property': {
      const key = node.key; // keep as-is unless computed
      const value = node.shorthand && node.value.type === 'Identifier'
        ? rewriteNode({ type: 'Identifier', name: node.value.name }, scopes, extraLocals, node)
        : rewriteNode(node.value, scopes, extraLocals, node);
      return { ...node, key, value, shorthand: false };
    }

    case 'ObjectExpression': {
      const properties = node.properties.map((p: Node) => rewriteNode(p, scopes, extraLocals, node));
      return { ...node, properties };
    }

    case 'ArrayExpression': {
      const elements = node.elements.map((e: Node) => rewriteNode(e, scopes, extraLocals, node));
      return { ...node, elements };
    }

    case 'CallExpression': {
      const callee = rewriteNode(node.callee, scopes, extraLocals, node);
      const args = node.arguments.map((a: Node) => rewriteNode(a, scopes, extraLocals, node));
      return { ...node, callee, arguments: args };
    }

    case 'NewExpression': {
      const callee = rewriteNode(node.callee, scopes, extraLocals, node);
      const args = node.arguments?.map((a: Node) => rewriteNode(a, scopes, extraLocals, node)) ?? [];
      return { ...node, callee, arguments: args };
    }

    case 'AssignmentExpression':
    case 'BinaryExpression':
    case 'LogicalExpression':
    case 'ConditionalExpression':
    case 'UnaryExpression':
    case 'UpdateExpression':
    case 'YieldExpression':
    case 'AwaitExpression':
    case 'SpreadElement':
    case 'RestElement':
    case 'AssignmentPattern': {
      const out: any = { ...node };
      for (const k of Object.keys(node)) {
        const v = (node as any)[k];
        if (v && typeof v === 'object' && 'type' in v) (out as any)[k] = rewriteNode(v, scopes, extraLocals, node);
      }
      return out;
    }

    case 'TemplateLiteral': {
      const quasis = node.quasis;
      const expressions = node.expressions.map((e: Node) => rewriteNode(e, scopes, extraLocals, node));
      return { ...node, quasis, expressions };
    }

    default: {
      // generic deep copy/transform
      if (node && typeof node === 'object') {
        const out: any = Array.isArray(node) ? [] : { ...node };
        for (const k of Object.keys(node)) {
          const v = (node as any)[k];
          if (v && typeof v === 'object' && 'type' in v) out[k] = rewriteNode(v, scopes, extraLocals, node);
          else if (Array.isArray(v)) out[k] = v.map((x: any) => (x && x.type ? rewriteNode(x, scopes, extraLocals, node) : x));
        }
        return out;
      }
      return node;
    }
  }
}

/** Rewrite a JS expression string so free identifiers become `ctx.<id>`. */
export function rewriteExpr(expr: string, extraLocals: string[] = []): string {
  try {
    const program = acorn.parse(`(${expr})`, { ecmaVersion: 'latest', sourceType: 'module' }) as Node;
    const exprNode = program.body[0].expression as Node;
    const ast = rewriteNode(exprNode, [new Set(extraLocals)], new Set(extraLocals), null);
    return generate(ast);
  } catch {
    // Fallback: return original on parse error
    return expr;
  }
}
