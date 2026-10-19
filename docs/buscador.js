// Buscador de la documentacion de Nova Engine (sin conexion y sin dependencias). nova_docgen lo copia junto a las
// paginas y genera su indice (buscador-indice.js: guias, secciones, todas las nativas de Lua y el diccionario
// docs/buscador-sinonimos.json). Busca sin tildes ni mayusculas, por trozos de palabra, con erratas («guardr») y por
// significado («guardar partida» -> SaveGame). En el navegador monta el cuadro de arriba de cada pagina (Ctrl+K o /);
// en Node exporta las funciones (sdk/docs-web/test/buscador.test.js).
(function (global) {
    "use strict";

    // --- Texto ------------------------------------------------------------------------------------------------

    var MARCAS = /[̀-ͯ]/g;

    // Minusculas y sin tildes ("Física" -> "fisica", "Ñandú" -> "nandu")
    function normalizar(texto) {
        return String(texto || "").normalize("NFD").replace(MARCAS, "").toLowerCase();
    }

    // Palabras que no ayudan a buscar
    var VACIAS = new Set(("a al algo como con cual cuando de del desde donde e el ella en entre es esa ese eso esta este esto hay " +
        "la las le les lo los mas me mi mis muy ni no o os para pero por que quiero se si sin sobre su sus te tu un una unas unos y ya yo " +
        "hacer hago puedo poner usar the an and or of to in on for with is it how do does can i my").split(" "));

    // "UnlockAchievement" -> ["Unlock", "Achievement"]; "GetUIElement" -> ["Get", "UI", "Element"]
    function separarCamel(palabra) {
        var partes = String(palabra).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").split(/[\s_]+/);
        return partes.filter(Boolean);
    }

    // Palabras de un texto para el indice: la palabra entera y sus trozos (camelCase y '_'), normalizadas
    function palabras(texto) {
        var out = [];
        var trozos = String(texto || "").split(/[^\p{L}\p{N}_]+/u);
        for (var i = 0; i < trozos.length; i++) {
            var t = trozos[i];
            if (!t) continue;
            out.push(normalizar(t));
            var partes = separarCamel(t);
            if (partes.length > 1) for (var j = 0; j < partes.length; j++) out.push(normalizar(partes[j]));
        }
        return out;
    }

    // Raiz aproximada en espanol (y algo de ingles): "guardar", "guardado", "guarda" -> "guard"
    var SUFIJOS = ["aciones", "imientos", "amientos", "imiento", "amiento", "acion", "ciones", "cion", "ando", "iendo", "adas", "ados", "idas", "idos",
        "ada", "ado", "ida", "ido", "ing", "ar", "er", "ir", "as", "es", "os", "ed", "a", "e", "o", "s"];
    function raiz(p) {
        if (p.length < 5) return p;
        for (var i = 0; i < SUFIJOS.length; i++) {
            var s = SUFIJOS[i];
            if (p.length - s.length >= 4 && p.endsWith(s)) return p.slice(0, p.length - s.length);
        }
        return p;
    }

    // Distancia de Damerau-Levenshtein (con transposiciones) con limite: max+1 si se pasa
    function distancia(a, b, max) {
        var la = a.length, lb = b.length;
        if (Math.abs(la - lb) > max) return max + 1;
        var prev2 = null, prev = new Array(lb + 1), cur = new Array(lb + 1);
        for (var j = 0; j <= lb; j++) prev[j] = j;
        for (var i = 1; i <= la; i++) {
            cur[0] = i;
            var minFila = i;
            for (var k = 1; k <= lb; k++) {
                var coste = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
                var v = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + coste);
                if (prev2 && k > 1 && a.charCodeAt(i - 1) === b.charCodeAt(k - 2) && a.charCodeAt(i - 2) === b.charCodeAt(k - 1)) {
                    v = Math.min(v, prev2[k - 2] + 1);
                }
                cur[k] = v;
                if (v < minFila) minFila = v;
            }
            if (minFila > max) return max + 1;
            var t = prev2 || new Array(lb + 1);
            prev2 = prev;
            prev = cur;
            cur = t;
        }
        return prev[lb];
    }

    function erratasPermitidas(n) {
        return n >= 8 ? 2 : n >= 4 ? 1 : 0;
    }

    // Parecido entre una palabra buscada y otra (0 = nada): exacta, misma raiz, el principio o con erratas
    function parecido(q, w) {
        if (q === w) return 1;
        if (q.length >= 4 && w.length >= 4 && raiz(q) === raiz(w)) return 0.9;
        if (q.length >= 3 && w.startsWith(q)) return 0.78 - Math.min(0.25, (w.length - q.length) * 0.03);
        if (w.length >= 4 && q.length > w.length && q.startsWith(w)) return 0.7;
        var max = erratasPermitidas(Math.min(q.length, w.length));
        if (max > 0) {
            var d = distancia(q, w, max);
            if (d <= max) return 0.74 - 0.12 * (d - 1);
        }
        return 0;
    }

    // --- Indice ------------------------------------------------------------------------------------------------

    var PESOS = { titulo: 3, contexto: 0.9, firma: 1, descripcion: 1.2, palabras: 0.7 };
    var SESGO = { n: 1, l: 1.15, g: 1.05, s: 0.9 };
    // Documentos para quien programa el motor o en C++ (diseno, arquitectura...): salen, pero despues de las guias de Lua
    var SECUNDARIAS = /^(scripts-cpp|diseno-|ESTADO-INTEGRACION|arquitectura|red\.html|libreria-|publicar-motor|terceros)/;

    function claveNormal(k) {
        return normalizar(k).replace(/:/g, ".").replace(/\(\)$/, "");
    }

    // Prepara el indice (una vez): vocabulario, listas de entradas por palabra y los conceptos del diccionario
    function crearIndice(datos) {
        var campos = datos.campos || ["tipo", "clave", "titulo", "firma", "descripcion", "url", "contexto", "palabras"];
        var entradas = (datos.entradas || []).map(function (fila) {
            if (!Array.isArray(fila)) return fila;
            var e = {};
            for (var i = 0; i < campos.length; i++) e[campos[i]] = fila[i] || "";
            return e;
        });
        var vocab = new Map(); // palabra -> id
        var lista = [];        // id -> palabra
        var posting = [];      // id -> Map(entrada -> peso)
        function anadir(texto, entrada, peso) {
            var ps = palabras(texto);
            for (var i = 0; i < ps.length; i++) {
                var p = ps[i];
                if (p.length < 2) continue;
                var id = vocab.get(p);
                if (id === undefined) {
                    id = lista.length;
                    vocab.set(p, id);
                    lista.push(p);
                    posting.push(new Map());
                }
                var m = posting[id];
                if ((m.get(entrada) || 0) < peso) m.set(entrada, peso);
            }
        }
        var claves = new Map();  // clave normalizada -> [entradas]
        var paginas = new Map(); // "savegame" -> [entradas de la pagina]
        var urls = new Map();
        for (var i = 0; i < entradas.length; i++) {
            var e = entradas[i];
            anadir(e.tipo === "n" ? e.titulo + " " + e.clave : e.titulo, i, PESOS.titulo);
            anadir(e.contexto, i, PESOS.contexto);
            if (e.firma) anadir(e.firma.replace(/^[^(:]*/, ""), i, PESOS.firma);
            anadir(e.descripcion, i, PESOS.descripcion);
            anadir(e.palabras, i, PESOS.palabras);
            var k = claveNormal(e.clave);
            if (!claves.has(k)) claves.set(k, []);
            claves.get(k).push(i);
            urls.set(e.url, i);
            if (e.tipo === "n" || e.tipo === "l") {
                var pag = e.tipo === "l" ? claveNormal(e.clave) : claveNormal(e.clave.split(/[.:]/)[0]);
                if (!paginas.has(pag)) paginas.set(pag, []);
                paginas.get(pag).push(i);
            }
        }
        // Listas compactas: [entrada, peso, entrada, peso...]
        var listas = posting.map(function (m) {
            var a = new Float64Array(m.size * 2), j = 0;
            m.forEach(function (peso, ent) { a[j++] = ent; a[j++] = peso; });
            return a;
        });
        var porRaiz = new Map();
        var porLongitud = [];
        for (var id = 0; id < lista.length; id++) {
            var w = lista[id];
            if (w.length >= 4) {
                var r = raiz(w);
                if (!porRaiz.has(r)) porRaiz.set(r, []);
                porRaiz.get(r).push(id);
            }
            (porLongitud[w.length] || (porLongitud[w.length] = [])).push(id);
        }
        var ordenadas = lista.map(function (w, n) { return n; }).sort(function (a, b) { return lista[a] < lista[b] ? -1 : lista[a] > lista[b] ? 1 : 0; });
        var indice = {
            version: datos.version || "", entradas: entradas, vocab: vocab, lista: lista, listas: listas, porRaiz: porRaiz,
            porLongitud: porLongitud, ordenadas: ordenadas, claves: claves, paginas: paginas, urls: urls, cache: new Map(), conceptos: []
        };
        indice.conceptos = prepararConceptos(indice, (datos.sinonimos && datos.sinonimos.conceptos) || []);
        return indice;
    }

    // Destino del diccionario -> entradas ("SaveGame.Save", "SaveGame.*" = la pagina y todos sus miembros, "SaveGame",
    // "pagina.html" o "pagina.html#ancla"). Vacio si no existe (por ejemplo una API que aun no esta en el motor)
    function resolverDestino(indice, destino) {
        var d = String(destino || "");
        if (d.endsWith(".*")) {
            var p = indice.paginas.get(claveNormal(d.slice(0, -2)));
            return p ? p.map(function (e) { return { e: e, comodin: indice.entradas[e].tipo !== "l" }; }) : [];
        }
        if (d.indexOf(".html") >= 0) {
            var u = indice.urls.get(d);
            return u === undefined ? [] : [{ e: u, comodin: false }];
        }
        var k = indice.claves.get(claveNormal(d));
        return k ? k.map(function (e) { return { e: e, comodin: false }; }) : [];
    }

    function prepararConceptos(indice, conceptos) {
        var out = [];
        for (var i = 0; i < conceptos.length; i++) {
            var c = conceptos[i];
            var frases = (c.palabras || []).map(function (f) {
                return palabras(f).filter(function (p) { return !VACIAS.has(p); });
            }).filter(function (f) { return f.length > 0; });
            var destinos = [];
            var vistos = new Set();
            (c.destinos || []).forEach(function (d, rango) {
                resolverDestino(indice, d).forEach(function (r) {
                    if (vistos.has(r.e)) return;
                    vistos.add(r.e);
                    destinos.push({ e: r.e, rango: rango, comodin: r.comodin });
                });
            });
            if (frases.length && destinos.length) out.push({ frases: frases, destinos: destinos, palabras: c.palabras });
        }
        // Palabras y raices del diccionario: una palabra buscada que esta tal cual no se compara con erratas
        indice.palabrasConceptos = new Set();
        out.forEach(function (c) {
            c.frases.forEach(function (f) {
                f.forEach(function (p) { indice.palabrasConceptos.add(p); indice.palabrasConceptos.add("~" + raiz(p)); });
            });
        });
        return out;
    }

    // Como parecido(), pero para el diccionario: el principio de una palabra cuenta desde 4 letras, y si la palabra
    // buscada ya esta en el diccionario, solo cuenta igual o con la misma raiz («saltar» no es «soltar» ni «salvar»)
    function parecidoConcepto(q, w, estricto) {
        if (q === w) return 1;
        if (q.length >= 4 && w.length >= 4 && raiz(q) === raiz(w)) return 0.9;
        if (estricto) return 0;
        if (q.length >= 4 && w.startsWith(q) && w.length - q.length <= 5) return 0.78 - (w.length - q.length) * 0.03;
        if (w.length >= 4 && q.length > w.length && q.startsWith(w)) return 0.7;
        var max = erratasPermitidas(Math.min(q.length, w.length));
        if (max > 0 && q.length >= 4) {
            var d = distancia(q, w, max);
            if (d <= max) return 0.74 - 0.12 * (d - 1);
        }
        return 0;
    }

    // Palabras del vocabulario parecidas a una buscada: Map(id -> calidad)
    function candidatos(indice, q, esUltima) {
        var clave = q + (esUltima ? "|u" : "");
        var hecho = indice.cache.get(clave);
        if (hecho) return hecho;
        var out = new Map();
        function poner(id, c) {
            if ((out.get(id) || 0) < c) out.set(id, c);
        }
        var exacta = indice.vocab.get(q);
        if (exacta !== undefined) poner(exacta, 1);
        if (q.length >= 4) {
            var mismas = indice.porRaiz.get(raiz(q));
            if (mismas) for (var i = 0; i < mismas.length; i++) poner(mismas[i], 0.9);
        }
        // Por el principio (busqueda binaria en las palabras ordenadas)
        if (q.length >= 3 || (esUltima && q.length >= 2)) {
            var lista = indice.lista, ord = indice.ordenadas, lo = 0, hi = ord.length;
            while (lo < hi) {
                var mid = (lo + hi) >> 1;
                if (lista[ord[mid]] < q) lo = mid + 1; else hi = mid;
            }
            for (var n = 0; lo < ord.length && n < 300; lo++, n++) {
                var w = lista[ord[lo]];
                if (!w.startsWith(q)) break;
                if (w !== q) poner(ord[lo], 0.8 - Math.min(0.3, (w.length - q.length) * 0.03));
            }
        }
        // Con erratas (solo palabras de longitud parecida que empiezan casi igual). Si la palabra existe tal cual, las
        // parecidas cuentan menos
        var max = erratasPermitidas(q.length);
        var factor = exacta !== undefined ? 0.55 : 1;
        if (max > 0) {
            for (var len = q.length - max; len <= q.length + max; len++) {
                var grupo = indice.porLongitud[len];
                if (!grupo) continue;
                for (var g = 0; g < grupo.length; g++) {
                    var p = indice.lista[grupo[g]];
                    if (p.charCodeAt(0) !== q.charCodeAt(0) && p.charCodeAt(1) !== q.charCodeAt(1)) continue;
                    var d = distancia(q, p, max);
                    if (d > 0 && d <= max) poner(grupo[g], (0.72 - 0.12 * (d - 1)) * factor);
                }
            }
        }
        // Dentro de otra palabra ("hitbox" en "raycasthitboxes")
        if (q.length >= 5) {
            for (var id = 0; id < indice.lista.length; id++) {
                var x = indice.lista[id];
                if (x.length > q.length && x.indexOf(q, 1) > 0) poner(id, 0.5);
            }
        }
        if (indice.cache.size > 400) indice.cache.clear();
        indice.cache.set(clave, out);
        return out;
    }

    // Conceptos del diccionario que encajan con la busqueda: [{concepto, fuerza}]. Una frase encaja si todas sus palabras
    // se parecen a alguna de las buscadas; cuantas mas palabras tiene y mas de la busqueda cubre, mas fuerza
    function conceptosDe(indice, qs) {
        var out = [];
        var estrictas = qs.map(function (q) { return indice.palabrasConceptos.has(q) || (q.length >= 4 && indice.palabrasConceptos.has("~" + raiz(q))); });
        for (var i = 0; i < indice.conceptos.length; i++) {
            var c = indice.conceptos[i], mejor = 0;
            for (var f = 0; f < c.frases.length; f++) {
                var frase = c.frases[f], minimo = 1, usadas = new Set();
                for (var t = 0; t < frase.length && minimo > 0; t++) {
                    var mejorT = 0, cual = -1;
                    for (var q = 0; q < qs.length; q++) {
                        var p = parecidoConcepto(qs[q], frase[t], estrictas[q]);
                        if (p > mejorT) { mejorT = p; cual = q; }
                    }
                    if (mejorT < 0.6) minimo = 0;
                    else { minimo = Math.min(minimo, mejorT); usadas.add(cual); }
                }
                if (!minimo) continue;
                var cobertura = usadas.size / qs.length;
                var fuerza = minimo * (1 + 0.3 * (frase.length - 1)) * (0.35 + 0.65 * cobertura);
                if (fuerza > mejor) mejor = fuerza;
            }
            if (mejor > 0) out.push({ concepto: c, fuerza: mejor });
        }
        return out;
    }

    // Palabras de la busqueda (normalizadas, sin las que no ayudan, sin repetir)
    function palabrasDeBusqueda(texto) {
        var todas = [];
        String(texto).split(/[^\p{L}\p{N}_.:]+/u).forEach(function (t) {
            if (!t) return;
            // "SaveGame.Save" o "self:Jump" -> sus palabras
            t.split(/[.:]/).forEach(function (u) {
                if (!u) return;
                todas.push(normalizar(u));
                var c = separarCamel(u);
                if (c.length > 1) c.forEach(function (x) { todas.push(normalizar(x)); });
            });
        });
        var qs = todas.filter(function (q) { return !VACIAS.has(q); });
        if (!qs.length) qs = todas;
        return qs.filter(function (q, i) { return qs.indexOf(q) === i; });
    }

    // Busca: { nativas, guias, secciones, todos, terminos, ms }
    function buscar(indice, consulta, opciones) {
        opciones = opciones || {};
        var t0 = Date.now();
        var texto = String(consulta || "").trim();
        var r = { consulta: texto, nativas: [], guias: [], secciones: [], todos: [], terminos: [], conceptos: 0, ms: 0 };
        var qs = texto ? palabrasDeBusqueda(texto) : [];
        if (!qs.length) return r;
        var N = indice.entradas.length;
        var total = new Float64Array(N), cuantas = new Uint8Array(N);
        var terminos = new Set();
        for (var qi = 0; qi < qs.length; qi++) {
            var q = qs[qi];
            var cands = candidatos(indice, q, qi === qs.length - 1);
            var mejor = new Map();
            cands.forEach(function (calidad, id) {
                if (calidad >= 0.7) terminos.add(indice.lista[id]);
                var l = indice.listas[id];
                for (var j = 0; j < l.length; j += 2) {
                    var v = calidad * l[j + 1];
                    if ((mejor.get(l[j]) || 0) < v) mejor.set(l[j], v);
                }
            });
            mejor.forEach(function (v, e) { total[e] += v; cuantas[e]++; });
            terminos.add(q);
        }
        var n = qs.length;
        var puntos = new Float64Array(N);
        for (var e = 0; e < N; e++) {
            if (!cuantas[e]) continue;
            var cob = cuantas[e] / n;
            var en0 = indice.entradas[e];
            puntos[e] = total[e] * (0.3 + 0.7 * cob * cob) * (SESGO[en0.tipo] || 1) * (SECUNDARIAS.test(en0.url) ? 0.6 : 1);
        }
        // La clave exacta ("SaveGame.Save", "physics.raycast")
        var exacta = indice.claves.get(claveNormal(texto.replace(/\s+/g, "")));
        if (exacta) exacta.forEach(function (x) { puntos[x] += 40; });
        // Por significado (diccionario)
        var conceptos = conceptosDe(indice, qs);
        for (var c = 0; c < conceptos.length; c++) {
            var k = conceptos[c], ds = k.concepto.destinos;
            for (var d = 0; d < ds.length; d++) {
                var dest = ds[d];
                puntos[dest.e] += k.fuerza * (dest.comodin ? 3 : 10 * Math.max(0.5, 1 - dest.rango * 0.06));
            }
        }
        var orden = [];
        for (var i = 0; i < N; i++) if (puntos[i] > 0.45) orden.push(i);
        orden.sort(function (a, b) { return puntos[b] - puntos[a] || indice.entradas[a].titulo.length - indice.entradas[b].titulo.length; });
        var limites = { nativas: opciones.nativas || 8, guias: opciones.guias || 4, secciones: opciones.secciones || 8 };
        r.terminos = Array.from(terminos);
        r.conceptos = conceptos.length;
        for (var o = 0; o < orden.length; o++) {
            var en = indice.entradas[orden[o]];
            var item = { entrada: en, puntos: puntos[orden[o]], indice: orden[o] };
            if (r.todos.length < (opciones.todos || 60)) r.todos.push(item);
            var grupo = en.tipo === "n" || en.tipo === "l" ? "nativas" : en.tipo === "g" ? "guias" : "secciones";
            if (r[grupo].length < limites[grupo]) r[grupo].push(item);
        }
        r.ms = Date.now() - t0;
        return r;
    }

    // --- Resaltado -----------------------------------------------------------------------------------------------

    function escapar(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    // HTML del texto con <mark> en las palabras buscadas (sin tildes ni mayusculas; tambien dentro de camelCase)
    function resaltar(texto, terminos) {
        texto = String(texto || "");
        var ts = (terminos || []).filter(function (t) { return t && t.length >= 2; }).sort(function (a, b) { return b.length - a.length; });
        if (!ts.length || !texto) return escapar(texto);
        // Texto normalizado caracter a caracter (para volver a las posiciones originales)
        var norm = "", mapa = [];
        for (var i = 0; i < texto.length; i++) {
            var n = normalizar(texto[i]);
            for (var j = 0; j < n.length; j++) { norm += n[j]; mapa.push(i); }
        }
        var marcas = new Uint8Array(texto.length);
        var re = /[\p{L}\p{N}_]+/gu, m;
        while ((m = re.exec(norm))) {
            var w = m[0], ini = m.index;
            for (var t = 0; t < ts.length; t++) {
                var term = ts[t], pos = -1, largo = term.length;
                if (w.startsWith(term)) pos = 0;
                else if (term.length >= 4 && w.length >= 4 && raiz(w) === raiz(term)) { pos = 0; largo = w.length; }
                else if (term.length >= 3) pos = w.indexOf(term);
                if (pos >= 0) {
                    var fin = Math.min(ini + pos + largo, ini + w.length);
                    for (var k = ini + pos; k < fin; k++) marcas[mapa[k]] = 1;
                    break;
                }
            }
        }
        var out = "", dentro = false;
        for (var c = 0; c < texto.length; c++) {
            if (marcas[c] && !dentro) { out += "<mark>"; dentro = true; }
            if (!marcas[c] && dentro) { out += "</mark>"; dentro = false; }
            out += escapar(texto[c]);
        }
        return out + (dentro ? "</mark>" : "");
    }

    var api = {
        normalizar: normalizar, palabras: palabras, raiz: raiz, distancia: distancia, parecido: parecido, crearIndice: crearIndice,
        buscar: buscar, resaltar: resaltar, resolverDestino: resolverDestino, palabrasDeBusqueda: palabrasDeBusqueda
    };
    if (typeof module !== "undefined" && module.exports) module.exports = api;
    global.NovaBuscador = api;

    // --- Interfaz (navegador) ------------------------------------------------------------------------------------

    if (typeof document === "undefined") return;

    var script = document.currentScript;
    var base = script && script.src ? script.src.replace(/[^/]*$/, "") : "";
    var indice = null, cargando = false, esperando = [];

    // Carga buscador-indice.js con un <script> (con file:// no se puede leer un .json) y prepara el indice
    function cargar(listo) {
        if (indice) { listo(indice); return; }
        esperando.push(listo);
        if (cargando) return;
        cargando = true;
        function preparar() {
            if (!global.NOVA_BUSCADOR_DATOS) { fallo(); return; }
            indice = crearIndice(global.NOVA_BUSCADOR_DATOS);
            var cola = esperando;
            esperando = [];
            cola.forEach(function (f) { f(indice); });
        }
        function fallo() {
            cargando = false;
            esperando = [];
            var panel = document.getElementById("buscador-resultados");
            if (panel) {
                panel.innerHTML = "<div class=\"vacio\">No se encuentra el índice del buscador (buscador-indice.js). Vuelve a compilar la documentación.</div>";
                panel.hidden = false;
            }
        }
        if (global.NOVA_BUSCADOR_DATOS) { preparar(); return; }
        var s = document.createElement("script");
        s.src = base + "buscador-indice.js";
        s.charset = "utf-8";
        s.onload = preparar;
        s.onerror = fallo;
        document.head.appendChild(s);
    }

    var EJEMPLOS = ["guardar partida", "saltar", "disparar", "sonido", "multijugador", "menú", "niebla", "enemigo que persigue", "logro", "idioma"];

    function iniciar() {
        var entrada = document.getElementById("buscador-entrada");
        var panel = document.getElementById("buscador-resultados");
        if (!entrada || !panel) return;
        var items = [], activo = -1, ultima = null;

        function abrir(abierto) {
            panel.hidden = !abierto;
            entrada.setAttribute("aria-expanded", abierto ? "true" : "false");
        }

        function marcar(i) {
            if (activo >= 0 && items[activo]) {
                items[activo].classList.remove("activo");
                items[activo].setAttribute("aria-selected", "false");
            }
            activo = i;
            if (activo >= 0 && items[activo]) {
                var a = items[activo];
                a.classList.add("activo");
                a.setAttribute("aria-selected", "true");
                entrada.setAttribute("aria-activedescendant", a.id);
                var top = a.offsetTop, alto = a.offsetHeight;
                if (top < panel.scrollTop) panel.scrollTop = Math.max(0, top - 30);
                else if (top + alto > panel.scrollTop + panel.clientHeight) panel.scrollTop = top + alto - panel.clientHeight + 6;
            } else {
                entrada.removeAttribute("aria-activedescendant");
            }
        }

        function ejemplos() {
            panel.innerHTML = "<div class=\"grupo\">Prueba a buscar</div><div class=\"vacio\">" + EJEMPLOS.map(function (e) {
                return "<a href=\"#\" class=\"ejemplo\" data-q=\"" + escapar(e) + "\" style=\"display:inline-block;margin:2px 4px 2px 0;padding:3px 10px;border:1px solid var(--borde);border-radius:20px\">" + escapar(e) + "</a>";
            }).join("") + "</div><div class=\"ayuda\">Busca en las guías y en todas las nativas de Lua, sin tildes y aunque te equivoques al escribir. " +
                "<kbd>Ctrl</kbd>+<kbd>K</kbd> o <kbd>/</kbd> para venir aquí.</div>";
            items = [];
            activo = -1;
            ultima = "";
            abrir(true);
        }

        function pintar() {
            var q = entrada.value;
            if (!q.trim()) { ejemplos(); return; }
            cargar(function (ind) {
                if (entrada.value !== q) return;
                if (q === ultima && !panel.hidden) return;
                ultima = q;
                var r = buscar(ind, q);
                var html = "", n = 0;
                function grupo(titulo, lista) {
                    if (!lista.length) return;
                    html += "<div class=\"grupo\" role=\"presentation\">" + titulo + "</div>";
                    lista.forEach(function (it) {
                        var e = it.entrada;
                        html += "<a href=\"" + escapar(e.url) + "\" id=\"br-" + n + "\" role=\"option\" aria-selected=\"false\" data-i=\"" + n + "\">" +
                            "<span class=\"titulo\">" + resaltar(e.titulo, r.terminos) + (e.contexto ? "<small>" + escapar(e.contexto) + "</small>" : "") + "</span>" +
                            (e.firma && e.tipo === "n" ? "<span class=\"firma\">" + resaltar(e.firma, r.terminos) + "</span>" : "") +
                            (e.descripcion ? "<span class=\"desc\">" + resaltar(e.descripcion, r.terminos) + "</span>" : "") + "</a>";
                        n++;
                    });
                }
                grupo("Nativas", r.nativas);
                grupo("Guías", r.guias);
                grupo("Secciones", r.secciones);
                if (!n) html = "<div class=\"vacio\">Nada para «" + escapar(q) + "». Prueba con otras palabras (por ejemplo «guardar», «sonido» o «red»).</div>";
                else html += "<div class=\"ayuda\">↑ ↓ para elegir · Enter para abrir · Esc para cerrar</div>";
                panel.innerHTML = html;
                items = Array.prototype.slice.call(panel.querySelectorAll("a[data-i]"));
                activo = -1;
                panel.scrollTop = 0;
                abrir(true);
                marcar(items.length ? 0 : -1);
            });
        }

        function ir(a) {
            if (!a) return;
            abrir(false);
            entrada.blur();
            var href = a.getAttribute("href");
            var almohadilla = href.indexOf("#");
            var pagina = almohadilla >= 0 ? href.slice(0, almohadilla) : href;
            var aqui = decodeURIComponent(location.pathname.replace(/^.*\//, ""));
            if (almohadilla >= 0 && (pagina === "" || pagina === aqui)) {
                var id = decodeURIComponent(href.slice(almohadilla + 1));
                if (location.hash === "#" + id || decodeURIComponent(location.hash) === "#" + id) {
                    var el = document.getElementById(id);
                    if (el) el.scrollIntoView();
                } else {
                    location.hash = id;
                }
            } else {
                location.href = href;
            }
        }

        entrada.addEventListener("input", function () { ultima = null; pintar(); });
        entrada.addEventListener("focus", function () { ultima = null; pintar(); });
        entrada.addEventListener("keydown", function (ev) {
            if (ev.key === "ArrowDown") {
                ev.preventDefault();
                if (panel.hidden) pintar();
                else if (items.length) marcar((activo + 1) % items.length);
            } else if (ev.key === "ArrowUp") {
                ev.preventDefault();
                if (items.length) marcar((activo - 1 + items.length) % items.length);
            } else if (ev.key === "Enter") {
                ev.preventDefault();
                ir(items[activo >= 0 ? activo : 0]);
            } else if (ev.key === "Escape") {
                ev.preventDefault();
                if (entrada.value && !panel.hidden) { entrada.value = ""; abrir(false); }
                else { abrir(false); entrada.blur(); }
            }
        });
        entrada.addEventListener("blur", function () {
            setTimeout(function () { if (document.activeElement !== entrada) abrir(false); }, 150);
        });
        panel.addEventListener("mousedown", function (ev) { ev.preventDefault(); }); // que el cuadro no pierda el foco
        panel.addEventListener("click", function (ev) {
            var a = ev.target.closest ? ev.target.closest("a") : null;
            if (!a) return;
            ev.preventDefault();
            if (a.classList.contains("ejemplo")) { entrada.value = a.getAttribute("data-q"); ultima = null; pintar(); return; }
            ir(a);
        });
        panel.addEventListener("mousemove", function (ev) {
            var a = ev.target.closest ? ev.target.closest("a[data-i]") : null;
            if (a) {
                var i = Number(a.getAttribute("data-i"));
                if (i !== activo) marcar(i);
            }
        });
        document.addEventListener("keydown", function (ev) {
            var t = ev.target, escribiendo = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
            if ((ev.ctrlKey || ev.metaKey) && !ev.altKey && (ev.key === "k" || ev.key === "K")) {
                ev.preventDefault();
                entrada.focus();
                entrada.select();
            } else if (ev.key === "/" && !escribiendo && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                ev.preventDefault();
                entrada.focus();
                entrada.select();
            }
        });
        // El indice se prepara cuando el navegador esta libre (asi la primera busqueda es inmediata)
        var libre = global.requestIdleCallback || function (f) { return setTimeout(f, 300); };
        libre(function () { cargar(function () {}); });
        // pagina.html?q=... : buscar al abrir
        var m = /[?&]q=([^&#]*)/.exec(location.search);
        if (m) {
            entrada.value = decodeURIComponent(m[1].replace(/\+/g, " "));
            entrada.focus();
            pintar();
        }
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar);
    else iniciar();
})(typeof window !== "undefined" ? window : globalThis);
