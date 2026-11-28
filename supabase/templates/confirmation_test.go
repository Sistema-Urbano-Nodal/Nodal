package templates

import (
	"bytes"
	"html"
	"html/template"
	"os"
	"strings"
	"testing"
)

// Run from the repository root with: go test ./supabase/templates/confirmation_test.go
// Supabase Auth uses html/template for both email fields.
func TestSignupConfirmation(t *testing.T) {
	load := func(name string) *template.Template {
		file, err := os.ReadFile(name)
		if err != nil {
			t.Fatal(err)
		}
		return template.Must(template.New(name).Parse(strings.TrimSpace(string(file))))
	}
	body, subject := load("confirmation.html"), load("confirmation.subject.txt")
	const site = "https://staging.example"
	const verify = "https://auth.example/verify?token=example&type=signup&redirect_to=https%3A%2F%2Fstaging.example%2Flogin.html"
	es, en, pt := "Confirma tu correo en NODAL", "Confirm your email for NODAL", "Confirme seu e-mail na NODAL"
	visible := map[string][]string{
		"es": {"Confirma tu correo para terminar de crear tu cuenta en NODAL.", "Confirmar mi correo", "Si no te registraste en NODAL, puedes ignorar este correo."},
		"en": {"Confirm your email address to finish creating your NODAL account.", "Confirm my email", "If you didn’t sign up for NODAL, you can ignore this email."},
		"pt": {"Confirme seu e-mail para concluir seu cadastro na NODAL.", "Confirmar meu e-mail", "Se você não se cadastrou na NODAL, pode ignorar este e-mail."},
	}
	cases := []struct {
		name     string
		metadata map[string]any
		locale   string
		title    string
	}{
		{"Spanish", map[string]any{"language": "es"}, "es", es},
		{"English", map[string]any{"language": "en"}, "en", en},
		{"Portuguese", map[string]any{"language": "pt"}, "pt", pt},
		{"no metadata", nil, "es", es},
		{"missing language", map[string]any{"name": "Example"}, "es", es},
		{"unknown", map[string]any{"language": "fr"}, "es", es},
		{"list", map[string]any{"language": []string{"en"}}, "es", es},
		{"object", map[string]any{"language": map[string]string{"value": "pt"}}, "es", es},
		{"markup", map[string]any{"language": "<img src=untrusted>"}, "es", es},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data := map[string]any{"SiteURL": site, "ConfirmationURL": verify, "Data": tc.metadata}
			var title, markup bytes.Buffer
			if err := subject.Execute(&title, data); err != nil {
				t.Fatal(err)
			}
			if title.String() != tc.title {
				t.Fatalf("unexpected subject %q", title.String())
			}
			if err := body.Execute(&markup, data); err != nil {
				t.Fatal(err)
			}
			document := html.UnescapeString(markup.String())
			for language, phrases := range visible {
				for _, phrase := range phrases {
					if strings.Contains(document, phrase) != (language == tc.locale) {
						t.Errorf("incorrect localization of %q", phrase)
					}
				}
			}
			for _, fragment := range []string{
				`<html lang="` + tc.locale + `">`, "<title>" + tc.title + "</title>",
				`class="btn-a" href="` + verify + `"`,
				`src="` + site + `/assets/email/nodal-lockup.png"`, `src="` + site + `/assets/email/nodal-lockup-dark.png"`,
			} {
				if !strings.Contains(document, fragment) {
					t.Errorf("missing rendered fragment %q", fragment)
				}
			}
			if strings.Contains(document, "untrusted") || strings.Contains(document, "#ZgotmplZ") {
				t.Error("unexpected metadata or invalid URL in email")
			}
			if strings.Count(document, verify) != 1 {
				t.Error("the verification link belongs only in the confirmation button")
			}
		})
	}
}
