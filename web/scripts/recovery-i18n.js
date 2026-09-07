(() => {
  'use strict';
  const rows = {
    language:['Language','Idioma','Idioma'],
    forgot:['Forgot your password?','¿Olvidaste tu contraseña?','Esqueceu sua senha?'],
    requestTitle:['Reset your password','Restablece tu contraseña','Redefina sua senha'],
    requestIntro:["Enter the email you used for NODAL. We'll send you a link to choose a new password.",'Escribe el correo que usaste en NODAL. Te enviaremos un enlace para elegir una nueva contraseña.','Digite o e-mail usado na NODAL. Vamos enviar um link para você escolher uma nova senha.'],
    browserNote:['Open the latest link in this same browser as soon as it arrives.','Abre el enlace más reciente en este mismo navegador en cuanto llegue.','Abra o link mais recente neste mesmo navegador assim que ele chegar.'],
    email:['Email','Correo electrónico','E-mail'],
    request:['Send reset link','Enviar enlace','Enviar link'],
    sent:['If an account uses this email, a reset link will arrive shortly. Check your spam folder. Open it in this same browser.','Si existe una cuenta con ese correo, pronto recibirás un enlace. Revisa la carpeta de spam y ábrelo en este mismo navegador.','Se houver uma conta com esse e-mail, você receberá um link em breve. Confira o spam e abra o link neste mesmo navegador.'],
    newTitle:['Choose a new password','Elige una nueva contraseña','Escolha uma nova senha'],
    newIntro:['Use a new password with 8–160 characters. After saving it, sign in again.','Usa una nueva contraseña de 8 a 160 caracteres. Después de guardarla, vuelve a iniciar sesión.','Use uma nova senha com 8 a 160 caracteres. Depois de salvar, entre novamente.'],
    password:['New password','Nueva contraseña','Nova senha'],
    confirm:['Confirm new password','Confirma la nueva contraseña','Confirme a nova senha'],
    save:['Save new password','Guardar nueva contraseña','Salvar nova senha'],
    saving:['Saving…','Guardando…','Salvando…'],
    sending:['Sending…','Enviando…','Enviando…'],
    done:['Your password has been changed. Sign in with your new password.','Tu contraseña ha sido cambiada. Inicia sesión con la nueva contraseña.','Sua senha foi alterada. Entre com a nova senha.'],
    doneTitle:['Password updated','Contraseña actualizada','Senha atualizada'],
    recovery_changed:['Your password has been changed. Sign in with your new password. We could not confirm the final session cleanup.','Tu contraseña ha sido cambiada. Inicia sesión con la nueva contraseña. No pudimos confirmar el cierre final de las sesiones.','Sua senha foi alterada. Entre com a nova senha. Não foi possível confirmar o encerramento final das sessões.'],
    recovery_invalid:['This link is invalid, expired, or already used. Request a new link and open it in the same browser.','Este enlace no es válido, ha caducado o ya se usó. Solicita otro y ábrelo en el mismo navegador.','Este link é inválido, expirou ou já foi usado. Solicite outro e abra no mesmo navegador.'],
    recovery_password_length:['Use 8–160 characters for your new password.','Usa entre 8 y 160 caracteres en tu nueva contraseña.','Use entre 8 e 160 caracteres na nova senha.'],
    mismatch:['The passwords do not match.','Las contraseñas no coinciden.','As senhas não coincidem.'],
    recovery_password_rejected:['The password could not be accepted. Request a new link, then choose a stronger password different from your previous one.','No se pudo aceptar la contraseña. Solicita otro enlace y elige una contraseña más segura y diferente de la anterior.','A senha não foi aceita. Solicite outro link e escolha uma senha mais forte e diferente da anterior.'],
    recovery_uncertain:['We could not confirm whether the password was saved. Try signing in with the new password. If it does not work, request a new reset link.','No pudimos confirmar si la contraseña se guardó. Intenta iniciar sesión con la nueva contraseña. Si no funciona, solicita otro enlace.','Não foi possível confirmar se a senha foi salva. Tente entrar com a nova senha. Se não funcionar, solicite outro link.'],
    recovery_unavailable:['Password recovery is temporarily unavailable. Please try again later.','La recuperación de contraseña no está disponible temporalmente. Inténtalo más tarde.','A recuperação de senha está temporariamente indisponível. Tente novamente mais tarde.'],
    recovery_rate:['Too many attempts. Wait a few minutes and try again.','Demasiados intentos. Espera unos minutos y vuelve a intentarlo.','Muitas tentativas. Aguarde alguns minutos e tente novamente.'],
    recovery_email:['Enter a valid email address.','Escribe un correo electrónico válido.','Digite um e-mail válido.'],
    recovery_forbidden:['Reload this page and try again.','Recarga esta página e inténtalo de nuevo.','Recarregue esta página e tente novamente.'],
    signIn:['Back to sign in','Volver a iniciar sesión','Voltar para entrar'],
    another:['Request another link','Solicitar otro enlace','Solicitar outro link'],
  };
  const rt=key=>rows[key]?.[({en:0,es:1,pt:2})[window.nodalI18n?.lang||'en']]||rows[key]?.[0]||key;
  function apply(){
    document.querySelectorAll('[data-recovery-text]').forEach(node=>{node.textContent=rt(node.dataset.recoveryText);});
    document.querySelectorAll('.lang-btn').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.lang===(window.nodalI18n?.lang||'en'))));
    if(document.body.dataset.page==='password-recovery'){document.title=rt('requestTitle')+' · NODAL';document.querySelector('.recovery-languages')?.setAttribute('aria-label',rt('language'));}
  }
  window.nodalRecoveryI18n={rows,rt,apply};window.nodalI18n?.onChange(apply);apply();
})();
