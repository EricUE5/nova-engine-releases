// Web de Nova Engine: tema claro u oscuro, índice lateral en el móvil, copiar el código y «en esta página».
(function () {
    "use strict";
    var raiz = document.documentElement;

    // Tema: se guarda en este navegador (si se puede); sin elegir, el del sistema
    var botonTema = document.querySelector(".boton-tema");
    if (botonTema) {
        botonTema.addEventListener("click", function () {
            var nuevo = raiz.getAttribute("data-theme") === "light" ? "dark" : "light";
            raiz.setAttribute("data-theme", nuevo);
            try { localStorage.setItem("nova-tema", nuevo); } catch (e) { /* sin almacenamiento */ }
        });
    }

    // Índice lateral en el móvil
    var botonMenu = document.querySelector(".boton-menu");
    var lateral = document.getElementById("lateral");
    if (botonMenu) {
        if (!lateral) botonMenu.hidden = true;
        botonMenu.addEventListener("click", function () {
            var abierto = document.body.classList.toggle("menu-abierto");
            botonMenu.setAttribute("aria-expanded", abierto ? "true" : "false");
        });
        document.addEventListener("click", function (ev) {
            if (!document.body.classList.contains("menu-abierto")) return;
            if (ev.target.closest(".lateral") && !ev.target.closest("a")) return;
            if (ev.target.closest(".boton-menu")) return;
            document.body.classList.remove("menu-abierto");
            botonMenu.setAttribute("aria-expanded", "false");
        });
        document.addEventListener("keydown", function (ev) {
            if (ev.key === "Escape" && document.body.classList.contains("menu-abierto")) {
                document.body.classList.remove("menu-abierto");
                botonMenu.setAttribute("aria-expanded", "false");
                botonMenu.focus();
            }
        });
    }
    // La página actual a la vista en el índice lateral
    if (lateral) {
        var actual = lateral.querySelector('[aria-current="page"]');
        if (actual && actual.scrollIntoView && lateral.scrollHeight > lateral.clientHeight) {
            lateral.scrollTop = Math.max(0, actual.offsetTop - lateral.clientHeight / 3);
        }
    }

    // Copiar el código
    document.addEventListener("click", function (ev) {
        var b = ev.target.closest ? ev.target.closest(".copiar") : null;
        if (!b) return;
        var pre = b.closest(".codigo").querySelector("pre");
        var texto = pre ? pre.innerText : "";
        var hecho = function () {
            var antes = b.textContent;
            b.textContent = b.getAttribute("data-copiado") || "OK";
            setTimeout(function () { b.textContent = antes; }, 1400);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(texto).then(hecho, function () {});
        } else {
            var t = document.createElement("textarea");
            t.value = texto;
            document.body.appendChild(t);
            t.select();
            try { document.execCommand("copy"); hecho(); } catch (e) { /* nada */ }
            document.body.removeChild(t);
        }
    });

    // «En esta página»: resalta la sección que se está leyendo
    var enlaces = Array.prototype.slice.call(document.querySelectorAll(".en-pagina a"));
    if (enlaces.length && "IntersectionObserver" in window) {
        var porId = {};
        enlaces.forEach(function (a) { porId[decodeURIComponent(a.getAttribute("href").slice(1))] = a; });
        var visibles = new Set();
        var obs = new IntersectionObserver(function (entradas) {
            entradas.forEach(function (e) {
                if (e.isIntersecting) visibles.add(e.target.id); else visibles.delete(e.target.id);
            });
            var primero = null;
            for (var i = 0; i < titulos.length; i++) {
                if (visibles.has(titulos[i].id)) { primero = titulos[i].id; break; }
            }
            if (!primero) return;
            enlaces.forEach(function (a) { a.classList.remove("activo"); });
            if (porId[primero]) porId[primero].classList.add("activo");
        }, { rootMargin: "-70px 0px -65% 0px" });
        var titulos = Array.prototype.slice.call(document.querySelectorAll(".doc h2[id], .doc h3[id]"));
        titulos.forEach(function (h) { if (porId[h.id]) obs.observe(h); });
    }
})();
