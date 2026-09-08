(() => {
  'use strict';
  const rows = {
    title: ['Your city', 'Tu ciudad', 'Sua cidade'],
    current: ["{city}", "{city}", "{city}"],
    missing: ['Not set', 'Sin definir', 'Não definida'],
    check: ["Verify", "Verificar", "Verificar"],
    automatic: ["Automatic", "Automático", "Automático"],
    privacy: ["GeoDB receives approximate coordinates. Precise location and history are not saved; directory sharing stays unchanged.", "GeoDB recibe coordenadas aproximadas. No se guardan la ubicación precisa ni su historial; la visibilidad del perfil no cambia.", "O GeoDB recebe coordenadas aproximadas. A localização precisa e o histórico não são salvos; a visibilidade do perfil não muda."],
    automaticHint: ["Once a day while visible, with existing browser permission.", "Una vez al día mientras esté visible, con permiso previo del navegador.", "Uma vez por dia enquanto estiver visível, com permissão prévia do navegador."],
    suggested: ['Approximate city: {city}', 'Ciudad aproximada: {city}', 'Cidade aproximada: {city}'],
    decision: ['Use this city for your profile and network map?', '¿Usar esta ciudad en tu perfil y en el mapa de la red?', 'Usar esta cidade no seu perfil e no mapa da rede?'],
    use: ["Update", "Actualizar", "Atualizar"],
    keep: ["Keep current", "Mantener actual", "Manter atual"],
    keepUnset: ["Keep current", "Mantener actual", "Manter atual"],
    locating: ["Locating…", "Localizando…", "Localizando…"],
    lookup: ["Finding city…", "Buscando ciudad…", "Buscando cidade…"],
    saving: ["Updating…", "Actualizando…", "Atualizando…"],
    updated: ["City updated.", "Ciudad actualizada.", "Cidade atualizada."],
    unchanged: ["Current city kept.", "Ciudad actual mantenida.", "Cidade atual mantida."],
    same: ["City unchanged.", "Ciudad sin cambios.", "Cidade sem alterações."],
    none: ["City not found. Try again.", "Ciudad no encontrada. Inténtalo de nuevo.", "Cidade não encontrada. Tente novamente."],
    unsupported: ["Location unavailable in this browser.", "Ubicación no disponible en este navegador.", "Localização indisponível neste navegador."],
    denied: ["Allow location in your browser to retry.", "Permite la ubicación en el navegador para reintentar.", "Permita a localização no navegador para tentar novamente."],
    unavailable: ["Location unavailable. Try again.", "Ubicación no disponible. Inténtalo de nuevo.", "Localização indisponível. Tente novamente."],
    timeout: ["Check timed out. Try again.", "La consulta expiró. Inténtalo de nuevo.", "A consulta expirou. Tente novamente."],
    imprecise: ["Location too imprecise. Try again.", "Ubicación demasiado imprecisa. Inténtalo de nuevo.", "Localização muito imprecisa. Tente novamente."],
    failed: ["Request failed. Try again.", "La solicitud falló. Inténtalo de nuevo.", "A solicitação falhou. Tente novamente."],
    signIn: ["Sign in again to continue.", "Inicia sesión de nuevo para continuar.", "Entre novamente para continuar."],
    rate: ["Too many checks. Try again later.", "Demasiadas consultas. Inténtalo más tarde.", "Muitas consultas. Tente novamente mais tarde."],
    conflict: ["City changed elsewhere. Reload before updating.", "La ciudad cambió en otra sesión. Recarga antes de actualizar.", "A cidade mudou em outra sessão. Recarregue antes de atualizar."],
    profileBusy: ["Saving other profile changes…", "Guardando otros cambios del perfil…", "Salvando outras alterações do perfil…"],
    cancel: ["Cancel", "Cancelar", "Cancelar"],
    source: ["GeoDB", "GeoDB", "GeoDB"],
  };
  const lt = (key, vars = {}) => String(rows[key]?.[({ en: 0, es: 1, pt: 2 })[window.nodalI18n?.lang] ?? 0] || rows[key]?.[0] || key)
    .replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
  window.nodalLocationI18n = { rows, lt };
})();
