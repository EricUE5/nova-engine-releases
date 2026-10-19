// Botón «Descargar Nova Engine»: pide la última versión a la API pública de GitHub y enlaza su instalador
// (NovaEngine-Setup-X.exe) con la versión, el tamaño y la fecha. Si la API falla (sin conexión, límite de peticiones),
// el botón se queda apuntando a la página de la última versión en GitHub, que siempre funciona.
(function () {
    "use strict";
    var botones = document.querySelectorAll(".js-descarga");
    if (!botones.length) return;
    var principal = document.querySelector(".js-descarga[data-api]");
    var api = principal ? principal.getAttribute("data-api") : null;
    if (!api) {
        // en las demás páginas: la API solo se consulta si ya está en la caché de esta sesión
        var m = /github\.com\/([^/]+\/[^/]+)\/releases/.exec(botones[0].getAttribute("href") || "");
        if (m) api = "https://api.github.com/repos/" + m[1] + "/releases/latest";
    }
    if (!api) return;
    var CLAVE = "nova-ultima-version";

    function megas(bytes) {
        return (bytes / (1024 * 1024)).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " MB";
    }

    function aplicar(d) {
        if (!d || !d.url) return;
        Array.prototype.forEach.call(botones, function (b) {
            b.setAttribute("href", d.url);
            b.setAttribute("title", d.nombre + (d.tamano ? " (" + megas(d.tamano) + ")" : ""));
        });
        var v = document.querySelector(".js-version");
        if (v && d.version) v.textContent = d.version;
        var t = document.querySelector(".js-tamano");
        if (t && d.tamano) t.textContent = megas(d.tamano);
        var f = document.querySelector(".js-fecha");
        if (f && d.fecha) {
            var fecha = new Date(d.fecha);
            if (!isNaN(fecha)) f.textContent = "Publicada el " + fecha.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }) + ".";
        }
    }

    var guardado = null;
    try { guardado = JSON.parse(sessionStorage.getItem(CLAVE) || "null"); } catch (e) { guardado = null; }
    if (guardado && Date.now() - guardado.cuando < 10 * 60 * 1000) { aplicar(guardado); return; }
    if (!principal || !window.fetch) return; // solo la portada pregunta a GitHub

    fetch(api, { headers: { Accept: "application/vnd.github+json" } })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (rel) {
            var assets = rel.assets || [];
            var exe = null;
            for (var i = 0; i < assets.length; i++) {
                if (/^NovaEngine-Setup.*\.exe$/i.test(assets[i].name)) { exe = assets[i]; break; }
            }
            if (!exe) for (var j = 0; j < assets.length; j++) {
                if (/\.exe$/i.test(assets[j].name)) { exe = assets[j]; break; }
            }
            var d = {
                url: exe ? exe.browser_download_url : rel.html_url,
                nombre: exe ? exe.name : (rel.name || rel.tag_name),
                tamano: exe ? exe.size : 0,
                version: String(rel.tag_name || "").replace(/^v/i, ""),
                fecha: rel.published_at,
                cuando: Date.now()
            };
            aplicar(d);
            try { sessionStorage.setItem(CLAVE, JSON.stringify(d)); } catch (e) { /* sin almacenamiento */ }
        })
        .catch(function () {
            // el enlace ya apunta a https://github.com/.../releases/latest
        });
})();
