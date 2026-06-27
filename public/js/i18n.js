"use strict";
/**
 * Lichte i18n-laag (zero-dep) voor Monargo One. NL is de basistaal, FR de
 * tweede landstaal (België). Vertaalt elk element met data-i18n (textContent),
 * data-i18n-ph (placeholder) en data-i18n-title (title), zet <html lang> en
 * onthoudt de keuze in localStorage. wfpI18n.t(key) is ook in JS bruikbaar zodat
 * platform-shells incrementeel kunnen vertalen.
 *
 * Bewust scope: de conversie-kritieke publieke flows (login, registratie,
 * activatie, reset, SSO) zijn volledig NL+FR. De diepe app-shells kunnen dit
 * woordenboek stap voor stap overnemen via data-i18n / wfpI18n.t().
 */
(function () {
  const DICT = {
    nl: {
      "hero.l1": "Plan slimmer.",
      "hero.l2": "Werk efficiënter.",
      "hero.l3": "Factureer sneller.",
      "hero.sub": "Eén platform voor planning, werkbonnen, tijdregistratie, facturen en facturatie — voor Belgische KMO's met teams op locatie.",
      "hero.b1": "Real-time overzicht voor kantoor en baan",
      "hero.b2": "Slimme planning & urenbeheer",
      "hero.b3": "Automatische facturatie & Peppol e-invoicing",
      "hero.b4": "Admin controle & rapportage",
      "hero.trustBE": "Vertrouwd in België",
      "hero.trustGDPR": "AVG / GDPR compliant",
      "login.welcome": "Welkom terug!",
      "login.subtitle": "Log in bij Monargo One",
      "login.email": "E-mail",
      "login.password": "Wachtwoord",
      "login.forgot": "Vergeten?",
      "login.mfa": "🛡️ Authenticator-code",
      "login.mfaHint": "Open je authenticator-app of gebruik een recovery code",
      "login.submit": "Inloggen",
      "login.sso": "🔐 Inloggen met SSO (Single Sign-On)",
      "login.noAccount": "Nog geen account?",
      "login.registerCompany": "Registreer je bedrijf",
      "login.demoTry": "Liever eerst de demo proberen?",
      "login.privacy": "Privacybeleid",
      "login.terms": "Algemene voorwaarden",
      "reg.title": "Account aanmaken",
      "reg.subtitle": "Start je eigen Monargo One — kies je pakket",
      "reg.vat": "BTW-/ondernemingsnummer",
      "reg.vatFetch": "Ophalen",
      "reg.company": "Bedrijfsnaam",
      "reg.yourName": "Jouw naam",
      "reg.plan": "Pakket",
      "reg.pwHint": "Je ontvangt een e-mail om je wachtwoord veilig in te stellen.",
      "reg.submit": "Account aanmaken",
      "reg.haveAccount": "Al een account?",
      "reg.login": "Inloggen",
      "reg.becomeReseller": "Reseller worden",
      "reg.registerCompany": "Bedrijf registreren",
      "reseller.title": "Reseller worden",
      "reseller.subtitle": "Vraag een partneraccount aan — wij keuren het goed",
      "reseller.submit": "Aanvraag indienen",
      "activate.title": "Stel je wachtwoord in",
      "activate.subtitle": "Activeer je Monargo One-account",
      "activate.newPw": "Nieuw wachtwoord",
      "activate.repeatPw": "Herhaal wachtwoord",
      "activate.submit": "Wachtwoord instellen & inloggen",
      "activate.resend": "Activatielink verlopen? Stuur opnieuw",
      "reset.title": "Nieuw wachtwoord",
      "reset.subtitle": "Kies een nieuw wachtwoord voor je account",
      "reset.submit": "Wachtwoord opslaan & inloggen",
      "reset.backToLogin": "Terug naar inloggen",
    },
    fr: {
      "hero.l1": "Planifiez plus malin.",
      "hero.l2": "Travaillez plus efficacement.",
      "hero.l3": "Facturez plus vite.",
      "hero.sub": "Une seule plateforme pour la planification, les bons de travail, le pointage et la facturation — pour les PME belges avec des équipes sur le terrain.",
      "hero.b1": "Vue en temps réel pour le bureau et le terrain",
      "hero.b2": "Planification intelligente & gestion des heures",
      "hero.b3": "Facturation automatique & e-facturation Peppol",
      "hero.b4": "Contrôle admin & rapports",
      "hero.trustBE": "De confiance en Belgique",
      "hero.trustGDPR": "Conforme RGPD",
      "login.welcome": "Bon retour !",
      "login.subtitle": "Connectez-vous à Monargo One",
      "login.email": "E-mail",
      "login.password": "Mot de passe",
      "login.forgot": "Oublié ?",
      "login.mfa": "🛡️ Code d'authentification",
      "login.mfaHint": "Ouvrez votre application d'authentification ou utilisez un code de récupération",
      "login.submit": "Se connecter",
      "login.sso": "🔐 Se connecter avec SSO (Single Sign-On)",
      "login.noAccount": "Pas encore de compte ?",
      "login.registerCompany": "Enregistrez votre entreprise",
      "login.demoTry": "Vous préférez d'abord essayer la démo ?",
      "login.privacy": "Politique de confidentialité",
      "login.terms": "Conditions générales",
      "reg.title": "Créer un compte",
      "reg.subtitle": "Lancez votre propre Monargo One — choisissez votre formule",
      "reg.vat": "Numéro de TVA / d'entreprise",
      "reg.vatFetch": "Récupérer",
      "reg.company": "Nom de l'entreprise",
      "reg.yourName": "Votre nom",
      "reg.plan": "Formule",
      "reg.pwHint": "Vous recevrez un e-mail pour définir votre mot de passe en toute sécurité.",
      "reg.submit": "Créer un compte",
      "reg.haveAccount": "Vous avez déjà un compte ?",
      "reg.login": "Se connecter",
      "reg.becomeReseller": "Devenir revendeur",
      "reg.registerCompany": "Enregistrer une entreprise",
      "reseller.title": "Devenir revendeur",
      "reseller.subtitle": "Demandez un compte partenaire — nous l'approuvons",
      "reseller.submit": "Soumettre la demande",
      "activate.title": "Définissez votre mot de passe",
      "activate.subtitle": "Activez votre compte Monargo One",
      "activate.newPw": "Nouveau mot de passe",
      "activate.repeatPw": "Répétez le mot de passe",
      "activate.submit": "Définir le mot de passe et se connecter",
      "activate.resend": "Lien d'activation expiré ? Renvoyer",
      "reset.title": "Nouveau mot de passe",
      "reset.subtitle": "Choisissez un nouveau mot de passe pour votre compte",
      "reset.submit": "Enregistrer le mot de passe et se connecter",
      "reset.backToLogin": "Retour à la connexion",
    },
  };

  function detectLang() {
    try {
      const saved = localStorage.getItem("wfp_lang");
      if (saved === "nl" || saved === "fr") return saved;
    } catch (_) {}
    const nav = (navigator.language || "nl").slice(0, 2).toLowerCase();
    return nav === "fr" ? "fr" : "nl";
  }

  let lang = detectLang();

  function t(key, fallback) {
    return (DICT[lang] && DICT[lang][key]) || (DICT.nl && DICT.nl[key]) || fallback || key;
  }

  function apply(root) {
    const scope = root || document;
    scope.querySelectorAll("[data-i18n]").forEach(el => {
      const v = t(el.getAttribute("data-i18n"), el.textContent);
      el.textContent = v;
    });
    scope.querySelectorAll("[data-i18n-ph]").forEach(el => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-ph"), el.getAttribute("placeholder") || ""));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach(el => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title"), el.getAttribute("title") || ""));
    });
    document.documentElement.setAttribute("lang", lang);
    // Knop-actieve staat synchroniseren
    document.querySelectorAll("[data-lang-btn]").forEach(b => {
      b.classList.toggle("active", b.getAttribute("data-lang-btn") === lang);
    });
  }

  function setLang(next) {
    if (next !== "nl" && next !== "fr") return;
    lang = next;
    try { localStorage.setItem("wfp_lang", next); } catch (_) {}
    apply(document);
    document.dispatchEvent(new CustomEvent("wfp:langchange", { detail: { lang } }));
  }

  window.wfpI18n = { t, setLang, apply, get lang() { return lang; }, DICT };

  // Pas toe zodra de DOM klaar is (script staat vóór de UI-scripts).
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => apply(document));
  } else {
    apply(document);
  }
})();
