(() => {
  'use strict';
  const rows={
    title:['Your place in the course','Tu lugar en el curso','Seu lugar no curso'],
    language:['Language','Idioma','Idioma'],
    intro:['Set up your NODAL account to accept your invitation. You will complete the intake form when you enter the course.','Prepara tu cuenta de NODAL para aceptar la invitación. Completarás el formulario inicial cuando entres al curso.','Configure sua conta NODAL para aceitar o convite. Você preencherá o formulário inicial ao entrar no curso.'],
    fullName:['Full name','Nombre completo','Nome completo'],
    password:['Choose a password','Elige una contraseña','Escolha uma senha'],
    passwordNote:['Use 8–160 characters. After saving, sign in with your email and this password.','Usa entre 8 y 160 caracteres. Después de guardar, inicia sesión con tu correo y esta contraseña.','Use entre 8 e 160 caracteres. Depois de salvar, entre com seu e-mail e esta senha.'],
    confirm:['Confirm password','Confirma la contraseña','Confirme a senha'],
    accept:['Accept invitation','Aceptar invitación','Aceitar convite'],
    saving:['Preparing your account…','Preparando tu cuenta…','Preparando sua conta…'],
    nameLength:['Enter your full name using 2–120 characters.','Escribe tu nombre completo con entre 2 y 120 caracteres.','Digite seu nome completo com entre 2 e 120 caracteres.'],
    invitation_name:['Check your name and try again.','Revisa tu nombre e inténtalo de nuevo.','Confira seu nome e tente novamente.'],
    invitation_password_length:['Use 8–160 characters for your password.','Usa entre 8 y 160 caracteres en tu contraseña.','Use entre 8 e 160 caracteres na senha.'],
    mismatch:['The passwords do not match.','Las contraseñas no coinciden.','As senhas não coincidem.'],
    invalidTitle:['Let’s get you into NODAL','Vamos a entrar a NODAL','Vamos entrar na NODAL'],
    invitation_invalid:['This invitation is missing, expired or already used. Ask the teaching team for a new invitation. If you already set up your account, sign in or reset your password below.','Esta invitación no está disponible, ha caducado o ya se usó. Pide otra al equipo docente. Si ya preparaste tu cuenta, inicia sesión o restablece tu contraseña abajo.','Este convite não está disponível, expirou ou já foi usado. Peça outro à equipe docente. Se você já configurou sua conta, entre ou redefina sua senha abaixo.'],
    invitation_password_rejected:['This password could not be accepted. Request a password reset below and choose a stronger password. Contact the teaching team if the course is not available after you sign in.','No se pudo aceptar esta contraseña. Solicita restablecerla abajo y elige una más segura. Contacta al equipo docente si el curso no aparece después de iniciar sesión.','Esta senha não foi aceita. Solicite a redefinição abaixo e escolha uma senha mais forte. Entre em contato com a equipe docente se o curso não aparecer após entrar.'],
    invitation_rate:['Too many attempts. Wait a few minutes and try again.','Demasiados intentos. Espera unos minutos y vuelve a intentarlo.','Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    invitation_forbidden:['Reload this page using the newest invitation email and try again.','Abre esta página desde el correo de invitación más reciente e inténtalo de nuevo.','Abra esta página pelo e-mail de convite mais recente e tente novamente.'],
    invitation_unavailable:['Invitations are temporarily unavailable. Open the newest invitation email again later.','Las invitaciones no están disponibles temporalmente. Abre de nuevo el correo de invitación más reciente más tarde.','Os convites estão temporariamente indisponíveis. Abra novamente o e-mail de convite mais recente mais tarde.'],
    invitation_uncertain:['We could not confirm whether your password was saved. Try signing in with the password you chose. If that does not work, reset your password below. Ask the teaching team if you cannot access the course.','No pudimos confirmar si la contraseña se guardó. Intenta iniciar sesión con la contraseña elegida. Si no funciona, restablécela abajo. Consulta al equipo docente si no puedes acceder al curso.','Não foi possível confirmar se sua senha foi salva. Tente entrar com a senha escolhida. Se não funcionar, redefina sua senha abaixo. Procure a equipe docente se não conseguir acessar o curso.'],
    doneTitle:['You’re ready to join','Todo listo para entrar','Tudo pronto para participar'],
    done:['Your password is saved and your course enrollment is confirmed. Sign in to complete your intake form and meet the group.','Tu contraseña está guardada y tu inscripción al curso está confirmada. Inicia sesión para completar el formulario inicial y conocer al grupo.','Sua senha foi salva e sua inscrição no curso foi confirmada. Entre para preencher seu formulário inicial e conhecer a turma.'],
    invitation_enrollment_pending:['Your password is saved. Sign in with it to check your course access. If the course is not available, ask the teaching team to finish your enrollment.','Tu contraseña está guardada. Inicia sesión para comprobar tu acceso al curso. Si no está disponible, pide al equipo docente que complete tu inscripción.','Sua senha foi salva. Entre para verificar seu acesso ao curso. Se não estiver disponível, peça à equipe docente que conclua sua inscrição.'],
    signIn:['Sign in to NODAL','Iniciar sesión en NODAL','Entrar na NODAL'],
    resetPassword:['Reset an existing password','Restablecer una contraseña existente','Redefinir uma senha existente'],
  };
  let language='en';
  try{const saved=localStorage.getItem('nodal.lang');if(['en','es','pt'].includes(saved))language=saved;}catch{}
  const t=key=>rows[key]?.[({en:0,es:1,pt:2})[language]]||rows[key]?.[0]||key;
  function apply(){
    document.documentElement.lang=language;document.title=t('title')+' · NODAL';
    document.querySelectorAll('[data-invitation-text]').forEach(node=>{node.textContent=t(node.dataset.invitationText);});
    document.querySelector('.recovery-languages')?.setAttribute('aria-label',t('language'));
    document.querySelectorAll('.lang-btn').forEach(node=>{node.classList.toggle('is-on',node.dataset.lang===language);node.setAttribute('aria-pressed',String(node.dataset.lang===language));});
  }
  document.querySelectorAll('.lang-btn').forEach(node=>node.addEventListener('click',()=>{language=node.dataset.lang;try{localStorage.setItem('nodal.lang',language);}catch{}apply();}));
  window.nodalInvitationI18n={t,apply,rows};apply();
})();
