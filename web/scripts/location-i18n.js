(() => {
  'use strict';
  const rows = {
    title: ['Your city', 'Tu ciudad', 'Sua cidade'],
    current: ['Saved city: {city}', 'Ciudad guardada: {city}', 'Cidade salva: {city}'],
    missing: ['Not set', 'Sin definir', 'Não definida'],
    check: ['Check city', 'Verificar ciudad', 'Verificar cidade'],
    automatic: ['Check automatically', 'Verificar automáticamente', 'Verificar automaticamente'],
    privacyDetails: ['Location and privacy', 'Ubicación y privacidad', 'Localização e privacidade'],
    privacy: ['Optional. GeoDB receives approximate coordinates to suggest a city. Precise position and location history are not saved. Your directory sharing choice stays the same.', 'Opcional. GeoDB recibe coordenadas aproximadas para sugerir una ciudad. No se guardan tu posición precisa ni un historial de ubicaciones. Tu elección de compartir el perfil no cambia.', 'Opcional. O GeoDB recebe coordenadas aproximadas para sugerir uma cidade. Sua posição precisa e seu histórico de localização não são salvos. Sua escolha de compartilhar o perfil não muda.'],
    automaticHint: ['At most once a day while this view is visible, and only if your browser has already allowed location access.', 'Como máximo una vez al día mientras esta vista esté visible y solo si el navegador ya permite acceder a tu ubicación.', 'No máximo uma vez por dia enquanto esta seção estiver visível e somente se o navegador já permitir acesso à localização.'],
    suggested: ['Approximate city: {city}', 'Ciudad aproximada: {city}', 'Cidade aproximada: {city}'],
    decision: ['Use this city for your profile and network map?', '¿Usar esta ciudad en tu perfil y en el mapa de la red?', 'Usar esta cidade no seu perfil e no mapa da rede?'],
    use: ['Use {city}', 'Usar {city}', 'Usar {city}'],
    keep: ['Keep {city}', 'Mantener {city}', 'Manter {city}'],
    keepUnset: ['Keep my profile as it is', 'Mantener mi perfil como está', 'Manter meu perfil como está'],
    locating: ['Checking your approximate location…', 'Comprobando tu ubicación aproximada…', 'Verificando sua localização aproximada…'],
    lookup: ['Looking up the city…', 'Buscando la ciudad…', 'Buscando a cidade…'],
    saving: ['Saving your city…', 'Guardando tu ciudad…', 'Salvando sua cidade…'],
    updated: ['Your profile city is now {city}. The network map is refreshing.', 'La ciudad de tu perfil ahora es {city}. El mapa de la red se está actualizando.', 'A cidade do seu perfil agora é {city}. O mapa da rede está sendo atualizado.'],
    unchanged: ['Your profile city has not changed.', 'La ciudad de tu perfil no ha cambiado.', 'A cidade do seu perfil não mudou.'],
    same: ['Your approximate location matches {city}. No change is needed.', 'Tu ubicación aproximada coincide con {city}. No hace falta cambiarla.', 'Sua localização aproximada corresponde a {city}. Não é necessário alterá-la.'],
    none: ['We could not identify a city here. You can edit your city in your profile.', 'No pudimos identificar una ciudad aquí. Puedes editarla en tu perfil.', 'Não foi possível identificar uma cidade aqui. Você pode editá-la no seu perfil.'],
    unsupported: ['This browser cannot check your location. You can still edit your city in your profile.', 'Este navegador no puede comprobar tu ubicación. Puedes editar la ciudad en tu perfil.', 'Este navegador não pode verificar sua localização. Você pode editar a cidade no seu perfil.'],
    denied: ['Location access is off. You can allow it in your browser settings, then try again. Your profile has not changed.', 'El acceso a la ubicación está desactivado. Puedes permitirlo en el navegador y volver a intentarlo. Tu perfil no ha cambiado.', 'O acesso à localização está desativado. Você pode permiti-lo no navegador e tentar novamente. Seu perfil não mudou.'],
    unavailable: ['Your location is unavailable. Try again when your connection improves.', 'Tu ubicación no está disponible. Inténtalo de nuevo cuando mejore la conexión.', 'Sua localização está indisponível. Tente novamente quando a conexão melhorar.'],
    timeout: ['The check took too long. Please try again.', 'La comprobación tardó demasiado. Inténtalo de nuevo.', 'A verificação demorou demais. Tente novamente.'],
    imprecise: ['Your location estimate is too broad to suggest a city reliably. Try again or edit your profile city manually.', 'La ubicación estimada es demasiado amplia para sugerir una ciudad con confianza. Inténtalo de nuevo o edita la ciudad manualmente.', 'A estimativa de localização é ampla demais para sugerir uma cidade com confiança. Tente novamente ou edite a cidade manualmente.'],
    failed: ['We could not complete this request. Please try again.', 'No pudimos completar esta solicitud. Inténtalo de nuevo.', 'Não foi possível concluir esta solicitação. Tente novamente.'],
    signIn: ['Sign in again before updating your city. Your choice is still shown here.', 'Vuelve a iniciar sesión antes de actualizar tu ciudad. Tu elección sigue aquí.', 'Entre novamente antes de atualizar sua cidade. Sua escolha continua aqui.'],
    rate: ['Too many checks. Wait a few minutes and try again.', 'Demasiadas comprobaciones. Espera unos minutos e inténtalo de nuevo.', 'Muitas verificações. Aguarde alguns minutos e tente novamente.'],
    conflict: ['Your profile city changed in another session. Reload the dashboard before updating it.', 'La ciudad de tu perfil cambió en otra sesión. Recarga el panel antes de actualizarla.', 'A cidade do seu perfil mudou em outra sessão. Recarregue o painel antes de atualizá-la.'],
    profileBusy: ['Wait for your other profile changes to finish saving.', 'Espera a que se guarden los otros cambios de tu perfil.', 'Aguarde o salvamento das outras alterações do seu perfil.'],
    cancel: ['Cancel check', 'Cancelar comprobación', 'Cancelar verificação'],
    source: ['City lookup: GeoDB', 'Consulta de ciudad: GeoDB', 'Consulta de cidade: GeoDB'],
  };
  const lt = (key, vars = {}) => String(rows[key]?.[({ en: 0, es: 1, pt: 2 })[window.nodalI18n?.lang] ?? 0] || rows[key]?.[0] || key)
    .replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(vars, name) ? String(vars[name]) : match);
  window.nodalLocationI18n = { rows, lt };
})();
