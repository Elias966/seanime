package anime

import "testing"

func TestLeadingEpisodeNumber(t *testing.T) {
	tests := map[string]string{
		"/lib/Mob Psycho 100 II/01.  Psycho 100 II [AnimeKaizoku].mkv":                   "01",
		"/lib/Sousou no Frieren/12 - The Hero's Statue.mkv":                               "12",
		"/lib/One Piece/[AnimeToki] [S01-E1179] One Piece [1080p] [Sub].mkv":              "1179",
		"/lib/Sousou no Frieren/Sousou no Frieren - S01E03 - Killing Magic.mkv":           "03",
		"/lib/Kobayashi/Trailers/The Eminence in Shadow - Season 2 Trailer 2.mkv":         "",
		"/lib/86/1080p Opening.mkv":                                                       "",
	}
	for p, want := range tests {
		if got := NewLocalFile(p, "/lib").ParsedData.Episode; got != want {
			t.Errorf("%s: episode %q, want %q", p, got, want)
		}
	}
}
