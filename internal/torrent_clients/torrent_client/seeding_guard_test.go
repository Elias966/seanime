package torrent_client

import (
	"net"
	"net/http"
	"net/http/httptest"
	"seanime/internal/torrent_clients/qbittorrent"
	"strconv"
	"strings"
	"sync"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/require"
)

func TestStopSeedingStopsOnlySeedingTorrents(t *testing.T) {
	var mu sync.Mutex
	var stopped string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		switch {
		case strings.HasSuffix(req.URL.Path, "/torrents/info"):
			_, _ = w.Write([]byte(`[{"hash":"aa","state":"stalledUP"},{"hash":"bb","state":"downloading"},{"hash":"cc","state":"uploading"},{"hash":"dd","state":"stoppedUP"}]`))
		case strings.HasSuffix(req.URL.Path, "/torrents/pause"):
			_ = req.ParseForm()
			mu.Lock()
			stopped = req.Form.Get("hashes")
			mu.Unlock()
		}
	}))
	defer server.Close()
	host, port, err := net.SplitHostPort(strings.TrimPrefix(server.URL, "http://"))
	require.NoError(t, err)
	portNumber, err := strconv.Atoi(port)
	require.NoError(t, err)

	logger := zerolog.Nop()
	repo := NewRepository(&NewRepositoryOptions{
		Logger:            &logger,
		Provider:          QbittorrentClient,
		QbittorrentClient: qbittorrent.NewClient(&qbittorrent.NewClientOptions{Logger: &logger, Host: host, Port: portNumber}),
	})
	repo.stopSeeding()

	mu.Lock()
	defer mu.Unlock()
	require.Equal(t, "aa|cc", stopped)
}
