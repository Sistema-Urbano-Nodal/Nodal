import { VISIT_PAGES, VISIT_SOURCES } from './visits-api.js';

// The indicator catalogue (spec: docs/superpowers/specs/2026-11-14-admin-front-door-metrics-design.md, "Indicator catalogue"):
// keys, fields, parts and the texts of the home, the CSV and print in three languages. One copy of each definition.

// Bumped in the same commit as any change to what an existing key counts. A new indicator gets a new key and no bump.
export const DEFS = 1;

export const FAMILIES = ['visits', 'signups', 'profiles', 'activity', 'memberships', 'festival', 'courses'];

const T = ['total'], W = ['d30', 'd7'], TW = ['total', 'd30', 'd7'], L = ['items'];
const ROWS = [
  // key, family, part, fields, vocabulary
  ['visits.views', 'visits', 'visits', W],
  ['visits.arrivals', 'visits', 'visits', W],
  ['visits.topPages', 'visits', 'visits', L, 'pages'],
  ['visits.sources', 'visits', 'visits', L, 'sources'],
  ['signups.accounts', 'signups', 'accounts', T],
  ['signups.confirmed', 'signups', 'accounts', T],
  ['signups.new', 'signups', 'accounts', W],
  ['signups.entered', 'signups', 'members', TW],
  ['signups.team', 'signups', 'members', T],
  ['profiles.basic', 'profiles', 'members', T],
  ['profiles.city', 'profiles', 'members', T],
  ['profiles.interests', 'profiles', 'members', T],
  ['profiles.bio', 'profiles', 'members', T],
  ['profiles.assessed', 'profiles', 'members', T],
  ['profiles.directory', 'profiles', 'members', T],
  ['profiles.saved', 'profiles', 'members', T],
  ['activity.members', 'activity', 'members', W],
  ['activity.kinds', 'activity', 'members', L, 'kinds'],
  ['activity.follows', 'activity', 'members', TW],
  ['activity.interests', 'activity', 'members', TW],
  ['memberships.founders', 'memberships', 'members', TW],
  ['memberships.acceptances', 'memberships', 'members', TW],
  ['memberships.acceptors', 'memberships', 'members', T],
  ['memberships.unbadged', 'memberships', 'members', T],
  ['memberships.orgRequests', 'memberships', 'members', T],
  ['memberships.views', 'memberships', 'visits', L, 'pages'],
  ['festival.registrations', 'festival', 'festival', T],
  ['festival.blockRegistrations', 'festival', 'festival', T],
  ['festival.attendances', 'festival', 'festival', T],
  ['festival.attendedPeople', 'festival', 'festival', T],
  ['festival.qrPeople', 'festival', 'festival', T],
  ['festival.hours', 'festival', 'festival', T],
  ['festival.labApplications', 'festival', 'festival', T],
  ['festival.profileTypes', 'festival', 'festival', L, 'profileTypes'],
  ['festival.countries', 'festival', 'members', L],
  ['courses.enrolled', 'courses', 'courses', ['total', 'items']],
  ['courses.intakeCompleted', 'courses', 'courses', ['total', 'items']],
  ['courses.moduleOpens', 'courses', 'courses', ['total', 'items']],
  ['courses.contentOpens', 'courses', 'courses', ['total', 'items']],
  ['courses.recordingOpens', 'courses', 'courses', ['total', 'items']],
  ['courses.assignments', 'courses', 'courses', ['total', 'items']],
  ['courses.comments', 'courses', 'courses', ['total', 'items']],
  ['courses.surveyTotal', 'courses', 'courses', T],
  ['courses.surveyAnswered', 'courses', 'courses', T],
  ['courses.certificates', 'courses', 'courses', T],
  ['courses.learners', 'courses', 'members', T],
  ['courses.openers', 'courses', 'members', T],
];

export const INDICATORS = Object.freeze(ROWS.map(([key, family, part, fields, vocabulary], i) => Object.freeze({
  key, family, order: i + 1, part, fields: Object.freeze([...fields]), ...(vocabulary ? { vocabulary } : {}),
})));

export const LEAD = Object.freeze([['visits.arrivals', 'd30'], ['signups.accounts', 'total'], ['profiles.basic', 'total'], ['activity.members', 'd30'], ['memberships.founders', 'total']]);
export const LEAD_SECOND = Object.freeze({
  'signups.accounts': [['signups.new', 'd7'], ['signups.confirmed', 'total']],
  'profiles.basic': [['profiles.assessed', 'total']],
  'activity.members': [['activity.members', 'd7']],
  'memberships.founders': [['memberships.acceptances', 'total']],
});

export const TRACKED = Object.freeze([
  'signups.accounts', 'signups.confirmed', 'signups.entered', 'profiles.basic', 'profiles.city', 'profiles.interests', 'profiles.bio',
  'profiles.assessed', 'profiles.directory', 'profiles.saved', 'activity.members.d30', 'activity.members.d7', 'activity.follows',
  'memberships.founders', 'memberships.acceptances', 'memberships.acceptors', 'festival.registrations', 'festival.attendedPeople',
  'festival.attendances', 'courses.enrolled', 'courses.learners', 'courses.certificates',
]);

export const MONTH_SERIES = Object.freeze(['accounts', 'entered', 'registrations', 'views', 'arrivals']);

/* The lists the home is laid out by, as keys, sent in the answer so the page holds no copy of them; frozen inside and
   out. ROUTE: the members' path drawn under the title, one stop per [key, field] in this order. 'apart' marks a stop
   that is not one more step after the one before it (the directory is by consent; the last stop is a 30-day window):
   the segment into it is dotted, and texts[lang].routeApart says why. That sentence names these two stops, so it
   changes with them. SERIES_INDICATOR: the indicator each month series splits by month (keys in MONTH_SERIES order);
   its chart stands in that indicator's family. PAIRS: [part, whole], two totals of one family where the part is truly
   inside the whole, printed as one row ("9 de 17"). */
const frozenRows = rows => Object.freeze(rows.map(row => Object.freeze(row)));
export const ROUTE = frozenRows([
  ['signups.accounts', 'total'], ['signups.confirmed', 'total'], ['signups.entered', 'total'], ['profiles.basic', 'total'],
  ['profiles.assessed', 'total'], ['profiles.directory', 'total', 'apart'], ['activity.members', 'd30', 'apart'],
]);
export const SERIES_INDICATOR = Object.freeze({ accounts: 'signups.new', entered: 'signups.entered', registrations: 'festival.registrations', views: 'visits.views', arrivals: 'visits.arrivals' });
export const PAIRS = frozenRows([['courses.surveyAnswered', 'courses.surveyTotal']]);

// Texts per indicator: [name, definition, source, caveat], in es, en, pt.
const X = {
  'visits.views': [
    ['Páginas vistas', 'Veces que se abrió una página pública o de miembro, sumadas por día de Lima (7 y 30 días). Cada recarga cuenta.', 'Contador de visitas (visit_counts)', 'No dice cuántas personas fueron. Los bloqueadores de scripts no se cuentan. Los navegadores del equipo donde se abrió una pantalla de administración quedan fuera, pero tras iniciar sesión sus visitas cuentan hasta que se abre una de esas pantallas. No está protegido contra un programa que infle el contador a propósito.'],
    ['Page views', 'Times a public or member page was opened, added up by Lima day (7 and 30 days). Every reload counts.', 'Visit counter (visit_counts)', 'It does not say how many people came. Script blockers are missed. Staff browsers where an admin screen was opened are left out, but after a sign-in the team\'s views count until one of those screens is opened. It is not protected against a program that inflates the counter on purpose.'],
    ['Páginas vistas', 'Vezes que uma página pública ou de membro foi aberta, somadas por dia de Lima (7 e 30 dias). Cada recarga conta.', 'Contador de visitas (visit_counts)', 'Não diz quantas pessoas vieram. Bloqueadores de scripts não são contados. Os navegadores da equipe onde uma tela de administração foi aberta ficam de fora, mas depois de entrar as visitas da equipe contam até que uma dessas telas seja aberta. Não é protegido contra um programa que infle o contador de propósito.'],
  ],
  'visits.arrivals': [
    ['Llegadas', 'Vistas cuyo origen está vacío o es otro sitio: alguien que llega desde fuera (7 y 30 días).', 'Contador de visitas (visit_counts)', 'No dice personas: quien llega dos días cuenta dos llegadas.'],
    ['Arrivals', 'Views whose referrer is empty or another site: someone coming in from outside (7 and 30 days).', 'Visit counter (visit_counts)', 'It does not say people: someone who arrives on two days counts two arrivals.'],
    ['Chegadas', 'Visualizações cuja origem está vazia ou é outro site: alguém que chega de fora (7 e 30 dias).', 'Contador de visitas (visit_counts)', 'Não diz pessoas: quem chega em dois dias conta duas chegadas.'],
  ],
  'visits.topPages': [
    ['Páginas más vistas', 'Las diez páginas con más vistas en 30 días.', 'Contador de visitas (visit_counts)', 'No dice si se leyeron.'],
    ['Most viewed pages', 'The ten pages with the most views in 30 days.', 'Visit counter (visit_counts)', 'It does not say whether they were read.'],
    ['Páginas mais vistas', 'As dez páginas com mais visualizações em 30 dias.', 'Contador de visitas (visit_counts)', 'Não diz se foram lidas.'],
  ],
  'visits.sources': [
    ['De dónde llegan', 'Las llegadas de 30 días agrupadas en once orígenes.', 'Contador de visitas (visit_counts.source)', 'No dice el sitio exacto. WhatsApp y el correo aparecen como "directo" salvo que el enlace lleve ?via= al final.'],
    ['Where they come from', 'Arrivals in 30 days grouped into eleven sources.', 'Visit counter (visit_counts.source)', 'It does not say the exact site. WhatsApp and email read "direct" unless the link ends with ?via=.'],
    ['De onde chegam', 'As chegadas de 30 dias agrupadas em onze origens.', 'Contador de visitas (visit_counts.source)', 'Não diz o site exato. WhatsApp e o e-mail aparecem como "direto" a menos que o link termine com ?via=.'],
  ],
  'signups.accounts': [
    ['Cuentas', 'Filas de auth.users: todas las cuentas creadas, incluidas las del equipo y cualquier cuenta no activa.', 'Cuentas (metrics_account_days)', 'No dice cuántas personas entraron. Si alguien borra su cuenta, el total baja.'],
    ['Accounts', 'Rows of auth.users: every account created, the team\'s and any non-active account included.', 'Accounts (metrics_account_days)', 'It does not say how many people came in. If someone deletes their account, the total goes down.'],
    ['Contas', 'Linhas de auth.users: todas as contas criadas, incluídas as da equipe e qualquer conta não ativa.', 'Contas (metrics_account_days)', 'Não diz quantas pessoas entraram. Se alguém apaga a conta, o total baixa.'],
  ],
  'signups.confirmed': [
    ['Con correo confirmado', 'Cuentas con email_confirmed_at no vacío.', 'Cuentas (auth.users)', 'No dice si usaron la cuenta. En la copia local es igual a Cuentas.'],
    ['With confirmed email', 'Accounts with email_confirmed_at not empty.', 'Accounts (auth.users)', 'It does not say whether they used the account. In the local copy it equals Accounts.'],
    ['Com e-mail confirmado', 'Contas com email_confirmed_at não vazio.', 'Contas (auth.users)', 'Não diz se usaram a conta. Na cópia local é igual a Contas.'],
  ],
  'signups.new': [
    ['Cuentas nuevas', 'Cuentas creadas en los últimos 7 y 30 días de Lima, y por mes; fecha de la última cuenta y días desde entonces.', 'Cuentas (auth.users.created_at)', 'No dice por qué se unieron.'],
    ['New accounts', 'Accounts created in the last 7 and 30 Lima days, and by month; the date of the latest account and the days since.', 'Accounts (auth.users.created_at)', 'It does not say why they joined.'],
    ['Contas novas', 'Contas criadas nos últimos 7 e 30 dias de Lima, e por mês; data da última conta e dias desde então.', 'Contas (auth.users.created_at)', 'Não diz por que entraram.'],
  ],
  'signups.entered': [
    ['Entraron al menos una vez', 'Filas de profiles, que se escriben en la primera sesión; nuevas por created_at en 7 y 30 días.', 'Perfiles (profiles)', 'No dice si volvieron. En la copia local es igual a Cuentas.'],
    ['Came in at least once', 'Rows of profiles, written at the first session; new by created_at in 7 and 30 days.', 'Profiles (profiles)', 'It does not say whether they came back. In the local copy it equals Accounts.'],
    ['Entraram ao menos uma vez', 'Linhas de profiles, escritas na primeira sessão; novas por created_at em 7 e 30 dias.', 'Perfis (profiles)', 'Não diz se voltaram. Na cópia local é igual a Contas.'],
  ],
  'signups.team': [
    ['Cuentas del equipo', 'Cuentas con profiles.app_role = admin. Están incluidas en Cuentas y en varias cifras con el equipo.', 'Perfiles (profiles / users.role)', 'Solo cuenta quien tiene el rol de administración hoy.'],
    ['Team accounts', 'Accounts with profiles.app_role = admin. They are included in Accounts and in several figures with the team.', 'Profiles (profiles / users.role)', 'It only counts whoever holds the admin role today.'],
    ['Contas da equipe', 'Contas com profiles.app_role = admin. Estão incluídas em Contas e em várias cifras com a equipe.', 'Perfis (profiles / users.role)', 'Só conta quem tem o papel de administração hoje.'],
  ],
  'profiles.basic': [
    ['Perfil básico completo', 'Ciudad no vacía y al menos un interés: dos de las cuatro cosas que pide el primer formulario (también pide nombre y rol).', 'Perfiles y respuestas de incorporación (profiles, onboarding_responses)', 'No dice si el perfil es bueno. Es el estado de hoy.'],
    ['Basic profile complete', 'City not blank and at least one interest: two of the four things the first-run form asks for (it also asks for a name and a role).', 'Profiles and onboarding answers (profiles, onboarding_responses)', 'It does not say whether the profile is good. It is today\'s state.'],
    ['Perfil básico completo', 'Cidade não vazia e ao menos um interesse: duas das quatro coisas que o primeiro formulário pede (também pede nome e papel).', 'Perfis e respostas de integração (profiles, onboarding_responses)', 'Não diz se o perfil é bom. É o estado de hoje.'],
  ],
  'profiles.city': [
    ['Con ciudad', 'Perfiles con la ciudad o región no vacía tras quitar espacios.', 'Perfiles (profiles.city_region)', 'No dice que la ciudad esté en el mapa. Es el estado de hoy.'],
    ['With a city', 'Profiles whose city or region is not blank once spaces are trimmed.', 'Profiles (profiles.city_region)', 'It does not say the city is placed on the map. It is today\'s state.'],
    ['Com cidade', 'Perfis com cidade ou região não vazia após remover espaços.', 'Perfis (profiles.city_region)', 'Não diz que a cidade esteja no mapa. É o estado de hoje.'],
  ],
  'profiles.interests': [
    ['Con intereses', 'Perfiles con al menos un interés marcado.', 'Respuestas de incorporación (onboarding_responses.interests)', 'Es el estado de hoy.'],
    ['With interests', 'Profiles with at least one interest ticked.', 'Onboarding answers (onboarding_responses.interests)', 'It is today\'s state.'],
    ['Com interesses', 'Perfis com ao menos um interesse marcado.', 'Respostas de integração (onboarding_responses.interests)', 'É o estado de hoje.'],
  ],
  'profiles.bio': [
    ['Con biografía', 'Biografía no vacía en el perfil o, si no, en la respuesta de la parte C de la incorporación.', 'Perfiles y respuestas de incorporación', 'No dice qué tan completa es. Es el estado de hoy.'],
    ['With a biography', 'A non-empty biography in the profile or, failing that, in the onboarding answer of part C.', 'Profiles and onboarding answers', 'It does not say how complete it is. It is today\'s state.'],
    ['Com biografia', 'Biografia não vazia no perfil ou, na falta, na resposta da parte C da integração.', 'Perfis e respostas de integração', 'Não diz quão completa é. É o estado de hoje.'],
  ],
  'profiles.assessed': [
    ['Autoevaluación hecha', 'Respuestas de incorporación marcadas como evaluadas.', 'Respuestas de incorporación (raw_answers.assessed / users.assessed)', 'Se marca con la primera respuesta: no dice si la terminaron ni cuándo.'],
    ['Self-assessment done', 'Onboarding answers marked as assessed.', 'Onboarding answers (raw_answers.assessed / users.assessed)', 'It is set on the first answer: it does not say whether they finished or when.'],
    ['Autoavaliação feita', 'Respostas de integração marcadas como avaliadas.', 'Respostas de integração (raw_answers.assessed / users.assessed)', 'É marcada com a primeira resposta: não diz se terminaram nem quando.'],
  ],
  'profiles.directory': [
    ['Visibles en el directorio', 'Cuenta activa y consentimiento para aparecer en el directorio.', 'Preferencias del perfil (profile_preferences)', 'No dice que alguien lo haya consultado. Es el estado de hoy.'],
    ['Visible in the directory', 'Active account and consent to appear in the directory.', 'Profile preferences (profile_preferences)', 'It does not say anyone looked. It is today\'s state.'],
    ['Visíveis no diretório', 'Conta ativa e consentimento para aparecer no diretório.', 'Preferências do perfil (profile_preferences)', 'Não diz que alguém tenha consultado. É o estado de hoje.'],
  ],
  'profiles.saved': [
    ['Perfil guardado', 'Filas de onboarding_responses: personas que guardaron algo en su consola alguna vez.', 'Respuestas de incorporación (onboarding_responses)', 'Basta con guardar cualquier formulario de la consola, incluso marcar avisos como leídos. Nunca una autoevaluación. Solo en producción: la copia local da 0.'],
    ['Profile saved', 'Rows of onboarding_responses: people who saved anything in their console at some point.', 'Onboarding answers (onboarding_responses)', 'Saving any console form is enough, even marking notices as read. Never a self-assessment. Production only: the local copy gives 0.'],
    ['Perfil salvo', 'Linhas de onboarding_responses: pessoas que salvaram algo em seu painel alguma vez.', 'Respostas de integração (onboarding_responses)', 'Basta salvar qualquer formulário do painel, mesmo marcar avisos como lidos. Nunca uma autoavaliação. Só em produção: a cópia local dá 0.'],
  ],
  'activity.members': [
    ['Miembros con actividad', 'Personas distintas, sin el equipo, con al menos una fila hecha por ellas en la ventana (7 y 30 días): guardar su perfil o marcar avisos como leídos, seguir o descartar, pedir información de una oportunidad, inscribirse o registrar asistencia en el festival, escribir, dar me gusta o valorar, abrir o publicar en un curso, enviar la encuesta final u opinión, aceptar los términos de la membresía.', 'Días de actividad de miembros (metrics_member_days)', 'No dice quién visitó sin hacer nada: leer no deja rastro. Cuenta de menos: quitar un me gusta, cancelar una inscripción o borrar la cuenta deja de contar.'],
    ['Members with activity', 'Distinct people, the team left out, with at least one row they made in the window (7 and 30 days): saving their profile or marking notices as read, following or skipping, asking about an opportunity, registering or checking in at the festival, writing, liking or rating, opening or posting in a course, sending the final survey or feedback, accepting the membership terms.', 'Member activity days (metrics_member_days)', 'It does not say who visited without doing anything: reading leaves no trace. It undercounts: removing a like, cancelling a registration or deleting an account stops counting.'],
    ['Membros com atividade', 'Pessoas distintas, sem a equipe, com ao menos uma linha feita por elas na janela (7 e 30 dias): salvar o perfil ou marcar avisos como lidos, seguir ou descartar, pedir informação de uma oportunidade, inscrever-se ou registrar presença no festival, escrever, curtir ou avaliar, abrir ou publicar em um curso, enviar a pesquisa final ou opinião, aceitar os termos da adesão.', 'Dias de atividade de membros (metrics_member_days)', 'Não diz quem visitou sem fazer nada: ler não deixa rastro. Conta a menos: tirar uma curtida, cancelar uma inscrição ou apagar a conta deixa de contar.'],
  ],
  'activity.kinds': [
    ['Actividad por tipo', 'El mismo número repartido en perfil, red, oportunidades, festival, cursos y membresía; la página y el CSV muestran los 30 y los 7 días. En perfil entra quien guardó su perfil o marcó avisos como leídos: no se pueden separar.', 'Días de actividad de miembros (metrics_member_days)', 'Los tipos se solapan: una persona puede estar en varios, así que no suman el total.'],
    ['Activity by kind', 'The same figure split into profile, network, opportunities, festival, courses and membership; the page and the CSV show the 30 and the 7 days. Profile holds whoever saved their profile or marked notices as read: the two cannot be told apart.', 'Member activity days (metrics_member_days)', 'The kinds overlap: one person can be in several, so they do not add up to the total.'],
    ['Atividade por tipo', 'O mesmo número repartido em perfil, rede, oportunidades, festival, cursos e adesão; a página e o CSV mostram os 30 e os 7 dias. Em perfil entra quem salvou o perfil ou marcou avisos como lidos: não é possível separar.', 'Dias de atividade de membros (metrics_member_days)', 'Os tipos se sobrepõem: uma pessoa pode estar em vários, então não somam o total.'],
  ],
  'activity.follows': [
    ['Conexiones (seguir)', 'Filas de member_follows, con las cuentas del equipo incluidas; nuevas en 7 y 30 días.', 'Seguimientos (member_follows / follows)', 'Incluye al equipo. No dice si la conexión se usó.'],
    ['Connections (follow)', 'Rows of member_follows, the team\'s accounts included; new in 7 and 30 days.', 'Follows (member_follows / follows)', 'The team is included. It does not say whether the connection was used.'],
    ['Conexões (seguir)', 'Linhas de member_follows, com as contas da equipe incluídas; novas em 7 e 30 dias.', 'Seguimentos (member_follows / follows)', 'Inclui a equipe. Não diz se a conexão foi usada.'],
  ],
  'activity.interests': [
    ['Solicitudes de interés', 'Filas de catalog_interests no retiradas, con el equipo incluido; nuevas en 7 y 30 días.', 'Intereses del catálogo (catalog_interests)', 'Incluye al equipo. No dice qué pasó después.'],
    ['Interest requests', 'Rows of catalog_interests not withdrawn, the team included; new in 7 and 30 days.', 'Catalog interests (catalog_interests)', 'The team is included. It does not say what happened next.'],
    ['Solicitações de interesse', 'Linhas de catalog_interests não retiradas, com a equipe incluída; novas em 7 e 30 dias.', 'Interesses do catálogo (catalog_interests)', 'Inclui a equipe. Não diz o que aconteceu depois.'],
  ],
  'memberships.founders': [
    ['Fundadores (insignias)', 'Perfiles con founder_since no vacío; nuevos por esa fecha.', 'Perfiles (profiles.founder_since / users)', 'No es un registro de pagos: el equipo entrega la insignia a mano tras comprobar Mercado Pago.'],
    ['Founders (badges)', 'Profiles with founder_since not empty; new by that date.', 'Profiles (profiles.founder_since / users)', 'It is not a payment record: the team gives the badge by hand after checking Mercado Pago.'],
    ['Fundadores (insígnias)', 'Perfis com founder_since não vazio; novos por essa data.', 'Perfis (profiles.founder_since / users)', 'Não é um registro de pagamentos: a equipe entrega a insígnia à mão após conferir o Mercado Pago.'],
  ],
  'memberships.acceptances': [
    ['Aceptaciones antes de pagar (veces)', 'Filas de membership_acceptances por accepted_at: quien empieza el pago dos veces son dos filas.', 'Aceptaciones de la membresía (membership_acceptances)', 'No es un pago ni una membresía.'],
    ['Acceptances before paying (times)', 'Rows of membership_acceptances by accepted_at: one person who starts the payment twice is two rows.', 'Membership acceptances (membership_acceptances)', 'It is not a payment or a membership.'],
    ['Aceitações antes de pagar (vezes)', 'Linhas de membership_acceptances por accepted_at: quem começa o pagamento duas vezes são duas linhas.', 'Aceitações da adesão (membership_acceptances)', 'Não é um pagamento nem uma adesão.'],
  ],
  'memberships.acceptors': [
    ['Personas que aceptaron', 'Cuentas distintas que aceptaron los términos, más las aceptaciones cuya cuenta ya no existe.', 'Aceptaciones de la membresía (membership_acceptances)', 'No es un pago ni una membresía.'],
    ['People who accepted', 'Distinct accounts that accepted the terms, plus acceptances whose account is gone.', 'Membership acceptances (membership_acceptances)', 'It is not a payment or a membership.'],
    ['Pessoas que aceitaram', 'Contas distintas que aceitaram os termos, mais as aceitações cuja conta já não existe.', 'Aceitações da adesão (membership_acceptances)', 'Não é um pagamento nem uma adesão.'],
  ],
  'memberships.unbadged': [
    ['Aceptaciones sin insignia (personas)', 'Cuentas distintas que aceptaron y no tienen founder_since, más las aceptaciones cuya cuenta ya no existe.', 'Aceptaciones y perfiles', 'No dice si pagaron: falta comprobar su pago o no pagaron.'],
    ['Acceptances without a badge (people)', 'Distinct accounts that accepted and have no founder_since, plus acceptances whose account is gone.', 'Acceptances and profiles', 'It does not say whether they paid: either the payment is still to be checked or they did not pay.'],
    ['Aceitações sem insígnia (pessoas)', 'Contas distintas que aceitaram e não têm founder_since, mais as aceitações cuja conta já não existe.', 'Aceitações e perfis', 'Não diz se pagaram: falta conferir o pagamento ou não pagaram.'],
  ],
  'memberships.orgRequests': [
    ['Solicitudes de organizaciones', 'Filas de node_requests (Nodo y patrocinio) en un solo total. Las nuevas alimentan "Por atender".', 'Solicitudes de organizaciones (node_requests)', 'Sin desglose por tipo ni estado. Las cerradas se borran a los 12 meses.'],
    ['Organisation requests', 'Rows of node_requests (Node and sponsorship) in one total. New ones feed "Needs attention".', 'Organisation requests (node_requests)', 'No split by kind or status. Closed ones are purged after 12 months.'],
    ['Solicitações de organizações', 'Linhas de node_requests (Nodo e patrocínio) em um só total. As novas alimentam "Para atender".', 'Solicitações de organizações (node_requests)', 'Sem divisão por tipo nem estado. As fechadas são apagadas após 12 meses.'],
  ],
  'memberships.views': [
    ['Vistas de Fundadores y de la página de pago', 'Vistas de /fundadores.html y /payments.html en 30 días, para ver el camino completo junto a las aceptaciones y las insignias.', 'Contador de visitas (visit_counts)', 'No dice personas.'],
    ['Views of Founders and the payment page', 'Views of /fundadores.html and /payments.html in 30 days, to see the whole path beside acceptances and badges.', 'Visit counter (visit_counts)', 'It does not say people.'],
    ['Visualizações de Fundadores e da página de pagamento', 'Visualizações de /fundadores.html e /payments.html em 30 dias, para ver o caminho completo junto às aceitações e às insígnias.', 'Contador de visitas (visit_counts)', 'Não diz pessoas.'],
  ],
  'festival.registrations': [
    ['Inscripciones', 'Las inscripciones del FIIU Fest 2026, las mismas que muestra el panel del festival. Incluye las del equipo, sin filtrar.', 'Resumen del festival (festivalSummary)', 'No dice asistencia.'],
    ['Registrations', 'Registrations for FIIU Fest 2026, the same the festival panel shows. Team registrations are included, not filtered.', 'Festival summary (festivalSummary)', 'It does not say attendance.'],
    ['Inscrições', 'As inscrições do FIIU Fest 2026, as mesmas que o painel do festival mostra. Inclui as da equipe, sem filtrar.', 'Resumo do festival (festivalSummary)', 'Não diz presença.'],
  ],
  'festival.blockRegistrations': [
    ['Inscripciones a bloques', 'Suma de las inscripciones de cada bloque: marcas de conferencias, postulaciones al laboratorio y la fiesta. Los intereses externos van aparte.', 'Resumen del festival (festivalSummary)', 'No dice personas: una persona cuenta una vez por cada bloque que eligió.'],
    ['Block registrations', 'Sum of each block\'s registrations: conference ticks, laboratory applications and the party. External interests are apart.', 'Festival summary (festivalSummary)', 'It does not say people: one person counts once for each block they chose.'],
    ['Inscrições em blocos', 'Soma das inscrições de cada bloco: marcas de conferências, candidaturas ao laboratório e a festa. Os interesses externos ficam à parte.', 'Resumo do festival (festivalSummary)', 'Não diz pessoas: uma pessoa conta uma vez por cada bloco que escolheu.'],
  ],
  'festival.attendances': [
    ['Asistencias registradas', 'Suma de las asistencias de cada bloque.', 'Resumen del festival (festivalSummary)', 'No dice la asistencia real: el registro en puerta fue parcial.'],
    ['Attendances recorded', 'Sum of each block\'s attendance.', 'Festival summary (festivalSummary)', 'It does not say real attendance: door check-in was partial.'],
    ['Presenças registradas', 'Soma das presenças de cada bloco.', 'Resumo do festival (festivalSummary)', 'Não diz a presença real: o registro na porta foi parcial.'],
  ],
  'festival.attendedPeople': [
    ['Personas con asistencia registrada', 'Personas distintas con al menos una asistencia registrada.', 'Resumen del festival (festivalSummary)', 'No dice la asistencia real: el registro en puerta fue parcial.'],
    ['People with attendance recorded', 'Distinct people with at least one attendance recorded.', 'Festival summary (festivalSummary)', 'It does not say real attendance: door check-in was partial.'],
    ['Pessoas com presença registrada', 'Pessoas distintas com ao menos uma presença registrada.', 'Resumo do festival (festivalSummary)', 'Não diz a presença real: o registro na porta foi parcial.'],
  ],
  'festival.qrPeople': [
    ['Con código QR propio', 'De ellas, las que registraron su asistencia con su propio código QR.', 'Resumen del festival (festivalSummary)', 'No dice la asistencia real.'],
    ['With their own QR code', 'Of them, those who checked in with their own QR code.', 'Festival summary (festivalSummary)', 'It does not say real attendance.'],
    ['Com código QR próprio', 'Entre elas, as que registraram a presença com seu próprio código QR.', 'Resumo do festival (festivalSummary)', 'Não diz a presença real.'],
  ],
  'festival.hours': [
    ['Horas de asistencia', 'En los bloques con registro de asistencia, las asistencias por la duración de cada bloque, sumadas y redondeadas una vez a horas enteras. El panel del festival muestra las mismas horas bloque por bloque.', 'Resumen del festival (server/fiiu-summary.js)', 'No dice el tiempo realmente pasado.'],
    ['Attendance hours', 'Over the blocks that take a check-in, attendances times each block\'s length, added up and rounded once to whole hours. The festival panel shows the same hours block by block.', 'Festival summary (server/fiiu-summary.js)', 'It does not say the time really spent.'],
    ['Horas de presença', 'Nos blocos com registro de presença, as presenças vezes a duração de cada bloco, somadas e arredondadas uma vez para horas inteiras. O painel do festival mostra as mesmas horas bloco a bloco.', 'Resumo do festival (server/fiiu-summary.js)', 'Não diz o tempo realmente gasto.'],
  ],
  'festival.labApplications': [
    ['Postulaciones al laboratorio', 'Postulaciones al laboratorio en un solo total (pendientes, aceptadas y no aceptadas). Las pendientes alimentan "Por atender".', 'Resumen del festival (server/fiiu-summary.js)', 'El detalle de aceptadas y no aceptadas queda en el panel del festival.'],
    ['Laboratory applications', 'Laboratory applications in one total (pending, accepted and declined). Pending ones feed "Needs attention".', 'Festival summary (server/fiiu-summary.js)', 'The split between accepted and declined stays on the festival panel.'],
    ['Candidaturas ao laboratório', 'Candidaturas ao laboratório em um só total (pendentes, aceitas e não aceitas). As pendentes alimentam "Para atender".', 'Resumo do festival (server/fiiu-summary.js)', 'O detalhe de aceitas e não aceitas fica no painel do festival.'],
  ],
  'festival.profileTypes': [
    ['Tipo de perfil', 'Inscripciones por el tipo de perfil que cada persona eligió. Un grupo de menos de 3 personas y la respuesta vacía con menos de 3 se juntan en "otros (menos de 3)".', 'Resumen del festival (festivalSummary)', 'Con "otros (menos de 3)" no se puede saber qué valores esconde.'],
    ['Profile type', 'Registrations by the profile type each person chose. A group of fewer than 3 people and the empty answer with fewer than 3 merge into "others (fewer than 3)".', 'Festival summary (festivalSummary)', 'With "others (fewer than 3)" the values it hides cannot be known.'],
    ['Tipo de perfil', 'Inscrições pelo tipo de perfil que cada pessoa escolheu. Um grupo com menos de 3 pessoas e a resposta vazia com menos de 3 se juntam em "outros (menos de 3)".', 'Resumo do festival (festivalSummary)', 'Com "outros (menos de 3)" não se sabe que valores esconde.'],
  ],
  'festival.countries': [
    ['País (respuesta de inscripción)', 'La respuesta de país al inscribirse, sin espacios, con mayúsculas y tildes unificadas; cada grupo lleva la grafía más frecuente. Las respuestas vacías (registro en puerta) se muestran como "sin respuesta" y solo se juntan en "otros (menos de 3)" cuando son menos de 3. Las de más de 40 caracteres o con símbolos raros y los grupos de menos de 3 personas siempre se juntan ahí.', 'Inscripciones al festival (fiiu_registrations.answers.country)', 'Texto libre: "Lima" queda como "Lima", no se convierte en Perú. No dice el país de quienes no se inscribieron al festival.'],
    ['Country (registration answer)', 'The country answer given at registration, trimmed, with case and accents folded; each group carries its most frequent spelling. Empty answers (door walk-ins) are shown as "no answer" and join "others (fewer than 3)" only when there are fewer than 3. Answers longer than 40 characters or with odd symbols, and groups of fewer than 3 people, always join it.', 'Festival registrations (fiiu_registrations.answers.country)', 'Free text: "Lima" stays "Lima", it is not turned into Peru. It does not say the country of members who did not register for the festival.'],
    ['País (resposta da inscrição)', 'A resposta de país na inscrição, sem espaços, com maiúsculas e acentos unificados; cada grupo leva a grafia mais frequente. As respostas vazias (registro na porta) aparecem como "sem resposta" e só se juntam em "outros (menos de 3)" quando são menos de 3. As de mais de 40 caracteres ou com símbolos estranhos e os grupos com menos de 3 pessoas sempre se juntam ali.', 'Inscrições no festival (fiiu_registrations.answers.country)', 'Texto livre: "Lima" fica "Lima", não vira Peru. Não diz o país de quem não se inscreveu no festival.'],
  ],
  'courses.surveyTotal': [
    ['Encuesta final: personas', 'Personas del grupo de septiembre, sin el equipo, a quienes se pide la encuesta final, como las cuenta el espacio docente.', 'Encuesta final (finalSurveyCounts)', 'No cuenta a quien se sumó desde octubre, así que puede ser menor que las personas inscritas.'],
    ['Final survey: people', 'People of the September group, the team left out, asked for the final survey, as the teaching workspace counts them.', 'Final survey (finalSurveyCounts)', 'It leaves out people who joined from October, so it can be below the enrolled people.'],
    ['Pesquisa final: pessoas', 'Pessoas do grupo de setembro, sem a equipe, a quem se pede a pesquisa final, como o espaço docente as conta.', 'Pesquisa final (finalSurveyCounts)', 'Não conta quem entrou desde outubro, então pode ser menor que as pessoas inscritas.'],
  ],
  'courses.surveyAnswered': [
    ['Encuesta final: respondieron', 'Personas del grupo de septiembre, sin el equipo, que enviaron la encuesta final.', 'Encuesta final (finalSurveyCounts)', 'No dice qué respondieron.'],
    ['Final survey: answered', 'People of the September group, the team left out, who sent the final survey.', 'Final survey (finalSurveyCounts)', 'It does not say what they answered.'],
    ['Pesquisa final: responderam', 'Pessoas do grupo de setembro, sem a equipe, que enviaram a pesquisa final.', 'Pesquisa final (finalSurveyCounts)', 'Não diz o que responderam.'],
  ],
  'courses.certificates': [
    ['Certificados subidos', 'Certificados subidos al curso, como los cuenta el espacio docente.', 'Encuesta final (finalSurveyCounts)', 'No dice descargas.'],
    ['Certificates uploaded', 'Certificates uploaded to the course, as the teaching workspace counts them.', 'Final survey (finalSurveyCounts)', 'It does not say downloads.'],
    ['Certificados enviados', 'Certificados enviados ao curso, como o espaço docente os conta.', 'Pesquisa final (finalSurveyCounts)', 'Não diz downloads.'],
  ],
  'courses.learners': [
    ['Personas inscritas, sin el equipo', 'Cuentas distintas, sin el equipo, con una inscripción en algún curso.', 'Inscripciones a cursos (course_enrollments)', 'No dice participación.'],
    ['Enrolled people, without the team', 'Distinct accounts, the team left out, enrolled in some course.', 'Course enrolments (course_enrollments)', 'It does not say participation.'],
    ['Pessoas inscritas, sem a equipe', 'Contas distintas, sem a equipe, com uma inscrição em algum curso.', 'Inscrições em cursos (course_enrollments)', 'Não diz participação.'],
  ],
  'courses.openers': [
    ['Abrieron contenido', 'Cuentas distintas, sin el equipo, con al menos una apertura de sesión o material.', 'Accesos a cursos (course_events)', 'No dice si lo leyeron o lo vieron completo.'],
    ['Opened content', 'Distinct accounts, the team left out, with at least one session or material opened.', 'Course accesses (course_events)', 'It does not say whether they read or watched it all.'],
    ['Abriram conteúdo', 'Contas distintas, sem a equipe, com ao menos uma abertura de sessão ou material.', 'Acessos a cursos (course_events)', 'Não diz se leram ou assistiram por completo.'],
  ],
};

// The seven totals of the teaching workspace, under its own names (web/scripts/pilot-i18n.js), with the team and per course.
const COURSE_TOTALS = {
  enrolled: [['Participants', 'Participantes', 'Participantes'], 'inscriptions', 'inscripciones', 'inscrições'],
  intakeCompleted: [['Intakes completed', 'Formularios completos', 'Formulários completos'], 'completed intake forms', 'formularios de ingreso completos', 'formulários de ingresso completos'],
  moduleOpens: [['Module accesses', 'Accesos a módulos', 'Acessos a módulos'], 'times a session was opened', 'veces que se abrió una sesión', 'vezes que uma sessão foi aberta'],
  contentOpens: [['Material accesses', 'Accesos a materiales', 'Acessos a materiais'], 'times a material was opened', 'veces que se abrió un material', 'vezes que um material foi aberto'],
  recordingOpens: [['Recording accesses', 'Accesos a grabaciones', 'Acessos a gravações'], 'times a recording was opened', 'veces que se abrió una grabación', 'vezes que uma gravação foi aberta'],
  assignments: [['Assignments', 'Actividades', 'Atividades'], 'submissions posted in the course', 'entregas publicadas en el curso', 'entregas publicadas no curso'],
  comments: [['Comments', 'Comentarios', 'Comentários'], 'comments on posts of the course', 'comentarios en las publicaciones del curso', 'comentários nas publicações do curso'],
};
for (const [id, [[en, es, pt], dEn, dEs, dPt]] of Object.entries(COURSE_TOTALS)) {
  X[`courses.${id}`] = [
    [es, `Con el equipo, como en el espacio docente: ${dEs}. Un total y su reparto por curso. Un acceso es una fila por persona, elemento y hora.`, 'Resumen del curso (courseSummary)', 'Incluye las cuentas del equipo. No dice estudio ni lectura. "Actividades" son entregas publicadas en el curso, no la familia Actividad.'],
    [en, `With the team, as in the teaching workspace: ${dEn}. One total and its split by course. An access is one row per person, item and hour.`, 'Course summary (courseSummary)', 'The team\'s accounts are included. It does not say study or reading. "Assignments" are submissions posted in the course, not the Activity family.'],
    [pt, `Com a equipe, como no espaço docente: ${dPt}. Um total e sua divisão por curso. Um acesso é uma linha por pessoa, item e hora.`, 'Resumo do curso (courseSummary)', 'Inclui as contas da equipe. Não diz estudo nem leitura. "Atividades" são entregas publicadas no curso, não a família Atividade.'],
  ];
}

const FAMILY_LABELS = {
  es: ['Visitas', 'Registros', 'Perfiles', 'Actividad', 'Membresías', 'Festival', 'Cursos'],
  en: ['Visits', 'Sign-ups', 'Profiles', 'Activity', 'Memberships', 'Festival', 'Courses'],
  pt: ['Visitas', 'Registros', 'Perfis', 'Atividade', 'Adesões', 'Festival', 'Cursos'],
};

const PAGE_LABELS = {
  'index.html': ['Inicio', 'Home', 'Início'], 'login.html': ['Entrar', 'Sign in', 'Entrar'], 'fundadores.html': ['Fundadores', 'Founders', 'Fundadores'],
  'opportunities.html': ['Oportunidades', 'Opportunities', 'Oportunidades'], 'community.html': ['Comunidad', 'Community', 'Comunidade'],
  'resources.html': ['Recursos', 'Resources', 'Recursos'], 'knowledge.html': ['Conocimiento', 'Knowledge', 'Conhecimento'], 'fiiu.html': ['FIIU Fest', 'FIIU Fest', 'FIIU Fest'],
  'fiiu-session.html': ['Sesión del FIIU', 'FIIU session', 'Sessão do FIIU'], 'dashboard.html': ['Mi panel', 'My console', 'Meu painel'], 'profile.html': ['Perfil', 'Profile', 'Perfil'],
  'payments.html': ['Pago', 'Payment', 'Pagamento'], 'courses.html': ['Cursos', 'Courses', 'Cursos'], 'course.html': ['Curso', 'Course', 'Curso'],
};
const SOURCE_LABELS = {
  direct: ['directo', 'direct', 'direto'], search: ['buscadores', 'search engines', 'buscadores'], whatsapp: ['WhatsApp', 'WhatsApp', 'WhatsApp'], email: ['correo', 'email', 'e-mail'],
  linkedin: ['LinkedIn', 'LinkedIn', 'LinkedIn'], instagram: ['Instagram', 'Instagram', 'Instagram'], facebook: ['Facebook', 'Facebook', 'Facebook'], x: ['X', 'X', 'X'],
  qr: ['código QR', 'QR code', 'código QR'], sistemaurbano: ['Sistema Urbano', 'Sistema Urbano', 'Sistema Urbano'], other: ['otros', 'other', 'outros'],
};
const KIND_LABELS = {
  profile: ['perfil (guardó su perfil o marcó avisos como leídos)', 'profile (saved their profile or marked notices as read)', 'perfil (salvou o perfil ou marcou avisos como lidos)'],
  network: ['red', 'network', 'rede'], opportunities: ['oportunidades', 'opportunities', 'oportunidades'], festival: ['festival', 'festival', 'festival'],
  courses: ['cursos', 'courses', 'cursos'], membership: ['membresía', 'membership', 'adesão'],
};
const PROFILE_TYPE_LABELS = {
  student: ['estudiante', 'student', 'estudante'], academic: ['academia', 'academia', 'academia'], researcher: ['investigación', 'research', 'pesquisa'],
  professional: ['profesional', 'professional', 'profissional'], entrepreneur: ['emprendimiento', 'entrepreneurship', 'empreendedorismo'], activist: ['activismo', 'activism', 'ativismo'],
  organization: ['organización', 'organisation', 'organização'], public_official: ['función pública', 'public service', 'função pública'], other: ['otro', 'other', 'outro'],
};
const RESERVED = { _other: ['otros (menos de 3)', 'others (fewer than 3)', 'outros (menos de 3)'], _none: ['sin respuesta', 'no answer', 'sem resposta'] };

const STATES = {
  es: { not_activated: 'Aún no está activado en la base de datos', unavailable: 'No disponible en este momento', not_yet_counted: 'Se cuenta desde el {day}', no_visits_yet: 'Aún no hay visitas contadas' },
  en: { not_activated: 'Not yet activated in the database', unavailable: 'Not available right now', not_yet_counted: 'Counted since {day}', no_visits_yet: 'No visits counted yet' },
  pt: { not_activated: 'Ainda não está ativado no banco de dados', unavailable: 'Indisponível no momento', not_yet_counted: 'Contado desde {day}', no_visits_yet: 'Ainda não há visitas contadas' },
};
// One label per entry of READING_PARTS (server/metrics-domain.js), in that order.
const PARTS = {
  es: ['cuentas', 'datos de miembros', 'festival', 'cursos', 'visitas', 'lecturas guardadas'],
  en: ['accounts', 'member data', 'festival', 'courses', 'visits', 'saved readings'],
  pt: ['contas', 'dados de membros', 'festival', 'cursos', 'visitas', 'leituras salvas'],
};
const PART_KEYS = ['accounts', 'members', 'festival', 'courses', 'visits', 'readings'];
const CSV = {
  es: {
    indicators: ['clave', 'estado', 'familia', 'indicador', 'total', '30 días', '7 días', 'definición', 'fuente', 'lo que no dice', 'leído (hora de Lima)'],
    months: ['mes (Lima)', 'cuentas nuevas', 'entraron por primera vez', 'inscripciones al festival', 'páginas vistas', 'llegadas'],
    readings: ['día (Lima)', 'leído (hora de Lima)', 'defs'],
  },
  en: {
    indicators: ['key', 'state', 'family', 'indicator', 'total', '30 days', '7 days', 'definition', 'source', 'what it does not say', 'read at (Lima time)'],
    months: ['month (Lima)', 'new accounts', 'first entries', 'festival registrations', 'page views', 'arrivals'],
    readings: ['day (Lima)', 'read at (Lima time)', 'defs'],
  },
  pt: {
    indicators: ['chave', 'estado', 'família', 'indicador', 'total', '30 dias', '7 dias', 'definição', 'fonte', 'o que não diz', 'lido (hora de Lima)'],
    months: ['mês (Lima)', 'contas novas', 'primeiras entradas', 'inscrições no festival', 'páginas vistas', 'chegadas'],
    readings: ['dia (Lima)', 'lido (hora de Lima)', 'defs'],
  },
};
const SERIES = {
  es: ['Cuentas nuevas', 'Entraron por primera vez', 'Inscripciones al festival', 'Páginas vistas', 'Llegadas'],
  en: ['New accounts', 'First entries', 'Festival registrations', 'Page views', 'Arrivals'],
  pt: ['Contas novas', 'Primeiras entradas', 'Inscrições no festival', 'Páginas vistas', 'Chegadas'],
};
// Why ROUTE's dotted segments are not one more step: it names its two 'apart' stops (the directory, the 30-day window).
const ROUTE_APART = {
  es: 'Tramo punteado: no es un paso más. El directorio es por consentimiento; la actividad se cuenta en 30 días.',
  en: 'Dotted segment: not one more step. The directory is by consent; activity is counted over 30 days.',
  pt: 'Trecho pontilhado: não é mais um passo. O diretório é por consentimento; a atividade é contada em 30 dias.',
};

const pageKeys = [...new Set(Object.values(VISIT_PAGES))];
const pick = (map, keys, i) => Object.fromEntries(keys.map(k => [k, map[k][i]]));

function build(lang, i) {
  return {
    families: Object.fromEntries(FAMILIES.map((f, n) => [f, FAMILY_LABELS[lang][n]])),
    indicators: Object.fromEntries(INDICATORS.map(({ key }) => {
      const [name, definition, source, caveat] = X[key][i];
      return [key, { name, definition, source, caveat }];
    })),
    lists: {
      pages: pick(PAGE_LABELS, pageKeys, i),
      sources: pick(SOURCE_LABELS, VISIT_SOURCES, i),
      kinds: pick(KIND_LABELS, Object.keys(KIND_LABELS), i),
      profileTypes: pick(PROFILE_TYPE_LABELS, Object.keys(PROFILE_TYPE_LABELS), i),
      reserved: pick(RESERVED, ['_other', '_none'], i),
    },
    parts: Object.fromEntries(PART_KEYS.map((k, n) => [k, PARTS[lang][n]])),
    states: { ...STATES[lang] },
    csv: CSV[lang],
    series: Object.fromEntries(MONTH_SERIES.map((k, n) => [k, SERIES[lang][n]])),
    routeApart: ROUTE_APART[lang],
  };
}

export const TEXTS = Object.freeze({ es: build('es', 0), en: build('en', 1), pt: build('pt', 2) });
