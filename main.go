package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"cloud.google.com/go/bigquery"
	"github.com/joho/godotenv"
	"google.golang.org/api/iterator"
	"google.golang.org/api/option"
)

// Global BigQuery client and config
var (
	bqClient   *bigquery.Client
	projectID  string
	hasCreds   bool
	authErrStr string
)

// Agent struct represents an AI Agent compliant with ERC-8004
type Agent struct {
	AgentID         int64    `json:"agent_id"`
	Owner           string   `json:"owner"`
	AgentURI        string   `json:"agent_uri"`
	AvgScore        float64  `json:"avg_score"`
	UniqueClients   int64    `json:"unique_clients"`
	FullyOnchain    bool     `json:"fully_onchain"`
	X402Support     bool     `json:"x402_support"`
	Name            string   `json:"name"`
	Description     string   `json:"description"`
	Category        string   `json:"category"`
	AvatarURL       string   `json:"avatar_url"`
	TEEValidated    bool     `json:"tee_validated"`
}

// Stats holds dashboard totals
type Stats struct {
	TotalAgents      int64   `json:"total_agents"`
	AvgReputation    float64 `json:"avg_reputation"`
	X402EnabledCount int64   `json:"x402_enabled_count"`
	X402Percentage   float64 `json:"x402_percentage"`
}

// DailyRegistration holds historical data for charts
type DailyRegistration struct {
	Day       string `json:"day"`
	NewAgents int64  `json:"new_agents"`
}

// Mock Database for Fallback Mode
var (
	mockAgents []Agent
	mockStats  Stats
	mockRegs   []DailyRegistration
)

func initMockData() {
	mockAgents = []Agent{
		{
			AgentID:       101,
			Owner:         "0x742d35cc6634c0532925a3b844bc454e4438f44e",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      96.80,
			UniqueClients: 12,
			FullyOnchain:  true,
			X402Support:   true,
			Name:          "AutoSwap-DeFi",
			Description:   "Autonomous liquidity provision and yield harvester routing stablecoin swaps.",
			Category:      "DeFi",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=autoswap",
			TEEValidated:  true,
		},
		{
			AgentID:       102,
			Owner:         "0x90f8bf65dccf1129992055b34bab55a111111111",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      92.40,
			UniqueClients: 8,
			FullyOnchain:  true,
			X402Support:   true,
			Name:          "CodeForge-AI",
			Description:   "On-chain agent that compiles and deploys audited ERC-20 smart contracts via prompts.",
			Category:      "Coding",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=codeforge",
			TEEValidated:  true,
		},
		{
			AgentID:       103,
			Owner:         "0x281055afc0532925a3b844bc454e4438f44e2222",
			AgentURI:      "https://ipfs.io/ipfs/QmSomeAgentMetadataHash",
			AvgScore:      84.00,
			UniqueClients: 5,
			FullyOnchain:  false,
			X402Support:   false,
			Name:          "WebScrape-Node",
			Description:   "Scrapes web APIs and uploads structured datasets to decentralized storage networks.",
			Category:      "Data Analytics",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=webscrape",
			TEEValidated:  false,
		},
		{
			AgentID:       104,
			Owner:         "0x1111111254fb6c44bac0bed2854e76f90643097d",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      78.50,
			UniqueClients: 3,
			FullyOnchain:  true,
			X402Support:   true,
			Name:          "SentimentScan-Bot",
			Description:   "Monitors social media feeds and runs natural language sentiment analyses for crypto pairs.",
			Category:      "Data Analytics",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=sentimentscan",
			TEEValidated:  true,
		},
		{
			AgentID:       105,
			Owner:         "0x88985afc0532925a3b844bc454e4438f44e33333",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      0.0,
			UniqueClients: 0,
			FullyOnchain:  true,
			X402Support:   false,
			Name:          "ENSPointer-Agent",
			Description:   "Helper agent that registers and auto-renews subnames for agent fleets via ENS registry.",
			Category:      "AI General",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=enspointer",
			TEEValidated:  false,
		},
		{
			AgentID:       106,
			Owner:         "0x33333333532925a3b844bc454e4438f44e44444",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      95.00,
			UniqueClients: 9,
			FullyOnchain:  true,
			X402Support:   true,
			Name:          "GigaTrader-Bot",
			Description:   "High-frequency cross-dex arbitrage bot running inside secure TEE environments.",
			Category:      "DeFi",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=gigatrader",
			TEEValidated:  true,
		},
		{
			AgentID:       107,
			Owner:         "0x55555555532925a3b844bc454e4438f44e55555",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      60.00,
			UniqueClients: 2,
			FullyOnchain:  true,
			X402Support:   false,
			Name:          "CrawlerService-AI",
			Description:   "Indexes blockchain event logs and compiles real-time feed snapshots for webhooks.",
			Category:      "Data Analytics",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=crawlerservice",
			TEEValidated:  false,
		},
		{
			AgentID:       108,
			Owner:         "0x77777777532925a3b844bc454e4438f44e77777",
			AgentURI:      "data:application/json;base64,...",
			AvgScore:      98.20,
			UniqueClients: 15,
			FullyOnchain:  true,
			X402Support:   true,
			Name:          "Autonome-TEE",
			Description:   "Standardized general agent executor running inside Intel SGX for verifiable computations.",
			Category:      "AI General",
			AvatarURL:     "https://api.dicebear.com/7.x/identicon/svg?seed=autonome",
			TEEValidated:  true,
		},
	}

	mockStats = Stats{
		TotalAgents:      8,
		AvgReputation:    83.12,
		X402EnabledCount: 5,
		X402Percentage:   62.5,
	}

	mockRegs = []DailyRegistration{
		{Day: "2026-06-01", NewAgents: 1},
		{Day: "2026-06-02", NewAgents: 0},
		{Day: "2026-06-03", NewAgents: 2},
		{Day: "2026-06-04", NewAgents: 1},
		{Day: "2026-06-05", NewAgents: 0},
		{Day: "2026-06-06", NewAgents: 0},
		{Day: "2026-06-07", NewAgents: 1},
		{Day: "2026-06-08", NewAgents: 3},
		{Day: "2026-06-09", NewAgents: 0},
		{Day: "2026-06-10", NewAgents: 1},
		{Day: "2026-06-11", NewAgents: 2},
		{Day: "2026-06-12", NewAgents: 4},
		{Day: "2026-06-13", NewAgents: 1},
	}
}

func main() {
	// Load environment variables
	_ = godotenv.Load()

	// Initialize mock data
	initMockData()

	// Locate and set credentials
	setupGCPAuth()

	// Initialize Server Router
	mux := http.NewServeMux()

	// API Endpoints
	mux.HandleFunc("/api/status", handleStatus)
	mux.HandleFunc("/api/agents", handleAgents)
	mux.HandleFunc("/api/leaderboard", handleLeaderboard)
	mux.HandleFunc("/api/stats", handleStats)
	mux.HandleFunc("/api/analytics", handleAnalytics)

	// Serve Static Files in production
	distPath := "./dist"
	if _, err := os.Stat(distPath); err == nil {
		fs := http.FileServer(http.Dir(distPath))
		mux.Handle("/", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			// If request path doesn't start with /api, serve index.html for SPA router
			if !strings.HasPrefix(r.URL.Path, "/api") {
				path := filepath.Join(distPath, r.URL.Path)
				if _, err := os.Stat(path); os.IsNotExist(err) {
					http.ServeFile(w, r, filepath.Join(distPath, "index.html"))
					return
				}
			}
			fs.ServeHTTP(w, r)
		}))
	}

	// CORS Middleware
	handler := corsMiddleware(mux)

	port := os.Getenv("PORT")
	if port == "" {
		port = "5001"
	}

	log.Printf("Starting Go server on port %s...", port)
	log.Printf("Credentials Loaded: %t (Err: %s)", hasCreds, authErrStr)
	if !hasCreds {
		log.Println("WARNING: Running in Demo Mode (Mock Data) because GCP BigQuery credentials are not configured.")
	}
	if err := http.ListenAndServe(":"+port, handler); err != nil {
		log.Fatal(err)
	}
}

func setupGCPAuth() {
	// 1. Check if local JSON file exists and programmatically set GOOGLE_APPLICATION_CREDENTIALS
	localCreds := "./gcp-service-account.json"
	if _, err := os.Stat(localCreds); err == nil {
		os.Setenv("GOOGLE_APPLICATION_CREDENTIALS", localCreds)
		log.Println("Found gcp-service-account.json, set GOOGLE_APPLICATION_CREDENTIALS environment variable")
	}

	// 2. Check if raw JSON string is provided in environment (common on Heroku)
	rawJSON := os.Getenv("GCP_SERVICE_ACCOUNT_JSON")
	ctx := context.Background()
	var err error

	if rawJSON != "" {
		// Extract project_id from raw JSON
		var credsMap map[string]interface{}
		if err := json.Unmarshal([]byte(rawJSON), &credsMap); err == nil {
			if pid, ok := credsMap["project_id"].(string); ok {
				projectID = pid
			}
		}
		if projectID == "" {
			projectID = "agent-trust-explorer"
		}

		bqClient, err = bigquery.NewClient(ctx, projectID, option.WithCredentialsJSON([]byte(rawJSON)))
		if err != nil {
			hasCreds = false
			authErrStr = fmt.Sprintf("Failed to initialize BigQuery with GCP_SERVICE_ACCOUNT_JSON: %v", err)
		} else {
			hasCreds = true
			authErrStr = ""
		}
		return
	}

	// 3. Fallback to file path credentials
	credsPath := os.Getenv("GOOGLE_APPLICATION_CREDENTIALS")
	if credsPath == "" {
		hasCreds = false
		authErrStr = "GOOGLE_APPLICATION_CREDENTIALS / GCP_SERVICE_ACCOUNT_JSON are not set and gcp-service-account.json is missing"
		return
	}

	// Parse Project ID from credentials file if possible, or environment variable
	projectID = os.Getenv("GCP_PROJECT_ID")
	if projectID == "" {
		if fileBytes, err := os.ReadFile(credsPath); err == nil {
			var credsMap map[string]interface{}
			if err := json.Unmarshal(fileBytes, &credsMap); err == nil {
				if pid, ok := credsMap["project_id"].(string); ok {
					projectID = pid
				}
			}
		}
	}

	if projectID == "" {
		projectID = "agent-trust-explorer"
	}

	bqClient, err = bigquery.NewClient(ctx, projectID, option.WithCredentialsFile(credsPath))
	if err != nil {
		hasCreds = false
		authErrStr = fmt.Sprintf("Failed to create BigQuery client with file: %v", err)
	} else {
		hasCreds = true
		authErrStr = ""
	}
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, DELETE")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func writeJSONError(w http.ResponseWriter, status int, msg string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"error":      msg,
		"needs_auth": !hasCreds,
	})
}

func handleStatus(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]interface{}{
		"connected":  hasCreds,
		"project_id": projectID,
		"error":      authErrStr,
		"using_mock": !hasCreds,
	})
}

func handleAgents(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// If no credentials, fall back to mock data
	if !hasCreds || bqClient == nil {
		_ = json.NewEncoder(w).Encode(mockAgents)
		return
	}

	ctx := context.Background()
	sql := `
		WITH agents AS (
			SELECT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
				CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27)) AS owner,
				SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
					data,
					131,
					2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
				)))                                              AS agent_uri
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' -- IdentityRegistry
				AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a' -- Registered
				AND block_timestamp >= TIMESTAMP '2026-01-28'
		),
		scores AS (
			SELECT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64) AS agent_id,
				COUNT(DISTINCT CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))) AS unique_clients,
				ROUND(AVG(
					SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) / 
					POW(10, SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64))
				), 2) AS avg_score
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004baa17c55a88189ae136b182e5fda19de9b63' -- ReputationRegistry
				AND topics[SAFE_OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc' -- NewFeedback
				AND block_timestamp >= TIMESTAMP '2026-01-28'
				AND SUBSTR(data, 67, 1) != 'f'
			GROUP BY 1
		),
		validations AS (
			SELECT DISTINCT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64) AS agent_id,
				TRUE AS tee_validated
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004bc032c525f0e136b182e5fda19de9b63a432' -- ValidationRegistry (Mock/Presumed address)
				AND topics[SAFE_OFFSET(0)] = '0xec26fe413a23ab786a14e6493f47dbe3ff1aa29e7785c96c8326a205e58fedc' -- Validated event signature
				AND block_timestamp >= TIMESTAMP '2026-01-28'
		)
		SELECT 
			a.agent_id, 
			a.owner,
			a.agent_uri, 
			COALESCE(s.avg_score, 0.0) AS avg_score, 
			COALESCE(s.unique_clients, 0) AS unique_clients,
			STARTS_WITH(a.agent_uri, 'data:application/json;base64,') AS fully_onchain,
			COALESCE(v.tee_validated, FALSE) AS tee_validated,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.x402Support'),
				'false'
			) AS x402_support_str,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.name'),
				''
			) AS name,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.description'),
				''
			) AS description,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.category'),
				''
			) AS category,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.avatarUrl'),
				''
			) AS avatar_url
		FROM agents a 
		LEFT JOIN scores s USING (agent_id)
		LEFT JOIN validations v USING (agent_id)
		ORDER BY a.agent_id DESC;
	`

	q := bqClient.Query(sql)
	it, err := q.Read(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("BigQuery error: %v", err))
		return
	}

	agents := []Agent{}
	for {
		var values []bigquery.Value
		err := it.Next(&values)
		if err == iterator.Done {
			break
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("Iterator error: %v", err))
			return
		}

		// Decode query row values
		agentID := getInt64(values[0])
		owner := getString(values[1])
		agentURI := getString(values[2])
		avgScore := getFloat64(values[3])
		uniqueClients := getInt64(values[4])
		fullyOnchain := getBool(values[5])
		teeValidated := getBool(values[6])
		x402SupportStr := getString(values[7])
		name := getString(values[8])
		description := getString(values[9])
		category := getString(values[10])
		avatarURL := getString(values[11])

		// Clean fallback values
		if name == "" {
			name = fmt.Sprintf("Agent #%d", agentID)
		}
		if description == "" {
			description = fmt.Sprintf("Autonomous agent registered by owner %s.", owner[:8])
		}
		if category == "" {
			category = "AI General"
		}

		x402Support := false
		if strings.ToLower(x402SupportStr) == "true" {
			x402Support = true
		}

		agents = append(agents, Agent{
			AgentID:       agentID,
			Owner:         owner,
			AgentURI:      agentURI,
			AvgScore:      avgScore,
			UniqueClients: uniqueClients,
			FullyOnchain:  fullyOnchain,
			X402Support:   x402Support,
			Name:          name,
			Description:   description,
			Category:      category,
			AvatarURL:     avatarURL,
			TEEValidated:  teeValidated,
		})
	}

	_ = json.NewEncoder(w).Encode(agents)
}

func handleLeaderboard(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// If no credentials, fall back to mock leaderboard items
	if !hasCreds || bqClient == nil {
		type LeaderboardItem struct {
			AgentID       int64   `json:"agent_id"`
			FeedbackCount int64   `json:"feedback_count"`
			UniqueClients int64   `json:"unique_clients"`
			AvgScore      float64 `json:"avg_score"`
			Name          string  `json:"name"`
			X402Support   bool    `json:"x402_support"`
		}

		items := []LeaderboardItem{}
		for _, a := range mockAgents {
			if a.UniqueClients >= 3 {
				items = append(items, LeaderboardItem{
					AgentID:       a.AgentID,
					FeedbackCount: a.UniqueClients * 2, // arbitrary mock ratio
					UniqueClients: a.UniqueClients,
					AvgScore:      a.AvgScore,
					Name:          a.Name,
					X402Support:   a.X402Support,
				})
			}
		}

		// Quick bubble sort for display ranking
		for i := 0; i < len(items); i++ {
			for j := i + 1; j < len(items); j++ {
				if items[i].AvgScore < items[j].AvgScore {
					items[i], items[j] = items[j], items[i]
				}
			}
		}

		_ = json.NewEncoder(w).Encode(items)
		return
	}

	ctx := context.Background()
	sql := `
		WITH feedback AS (
			SELECT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)              AS agent_id,
				CONCAT('0x', SUBSTR(topics[SAFE_OFFSET(2)], 27))        AS client,
				SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) AS raw_value,
				SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64) AS value_decimals
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004baa17c55a88189ae136b182e5fda19de9b63'                 -- ReputationRegistry address
				AND topics[SAFE_OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'    -- NewFeedback event
				AND block_timestamp >= TIMESTAMP '2026-01-28'
				AND SUBSTR(data, 67, 1) != 'f'
		),
		agents AS (
			SELECT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
				SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
					data,
					131,
					2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
				)))                                              AS agent_uri
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432' 
				AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
				AND block_timestamp >= TIMESTAMP '2026-01-28'
		)
		SELECT 
			a.agent_id, 
			COUNT(f.raw_value) AS feedback_count,
			COUNT(DISTINCT f.client) AS unique_clients,
			ROUND(AVG(f.raw_value / POW(10, f.value_decimals)), 2) AS avg_score,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.name'),
				''
			) AS name,
			IF(
				STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
				JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
					SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
				)), '$.x402Support'),
				'false'
			) AS x402_support_str
		FROM agents a
		JOIN feedback f USING (agent_id)
		GROUP BY a.agent_id, a.agent_uri
		HAVING unique_clients >= 3
		ORDER BY avg_score DESC, unique_clients DESC
		LIMIT 20;
	`

	q := bqClient.Query(sql)
	it, err := q.Read(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("BigQuery error: %v", err))
		return
	}

	type LeaderboardItem struct {
		AgentID       int64   `json:"agent_id"`
		FeedbackCount int64   `json:"feedback_count"`
		UniqueClients int64   `json:"unique_clients"`
		AvgScore      float64 `json:"avg_score"`
		Name          string  `json:"name"`
		X402Support   bool    `json:"x402_support"`
	}

	items := []LeaderboardItem{}
	for {
		var values []bigquery.Value
		err := it.Next(&values)
		if err == iterator.Done {
			break
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("Iterator error: %v", err))
			return
		}

		agentID := getInt64(values[0])
		feedbackCount := getInt64(values[1])
		uniqueClients := getInt64(values[2])
		avgScore := getFloat64(values[3])
		name := getString(values[4])
		x402SupportStr := getString(values[5])

		if name == "" {
			name = fmt.Sprintf("Agent #%d", agentID)
		}

		x402Support := false
		if strings.ToLower(x402SupportStr) == "true" {
			x402Support = true
		}

		items = append(items, LeaderboardItem{
			AgentID:       agentID,
			FeedbackCount: feedbackCount,
			UniqueClients: uniqueClients,
			AvgScore:      avgScore,
			Name:          name,
			X402Support:   x402Support,
		})
	}

	_ = json.NewEncoder(w).Encode(items)
}

func handleStats(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// If no credentials, fall back to mock stats
	if !hasCreds || bqClient == nil {
		_ = json.NewEncoder(w).Encode(mockStats)
		return
	}

	ctx := context.Background()
	sql := `
		WITH agents AS (
			SELECT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64)       AS agent_id,
				SAFE_CONVERT_BYTES_TO_STRING(FROM_HEX(SUBSTR(
					data,
					131,
					2 * SAFE_CAST(CONCAT('0x', SUBSTR(data, 67, 64)) AS INT64)
				)))                                              AS agent_uri
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'
				AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
				AND block_timestamp >= TIMESTAMP '2026-01-28'
		),
		scores AS (
			SELECT
				SAFE_CAST(topics[SAFE_OFFSET(1)] AS INT64) AS agent_id,
				ROUND(AVG(
					SAFE_CAST(CONCAT('0x', SUBSTR(data,  67, 64)) AS INT64) / 
					POW(10, SAFE_CAST(CONCAT('0x', SUBSTR(data, 131, 64)) AS INT64))
				), 2) AS avg_score
			FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
			WHERE address = '0x8004baa17c55a88189ae136b182e5fda19de9b63'
				AND topics[SAFE_OFFSET(0)] = '0x6a4a61743519c9d648a14e6493f47dbe3ff1aa29e7785c96c8326a205e58febc'
				AND block_timestamp >= TIMESTAMP '2026-01-28'
				AND SUBSTR(data, 67, 1) != 'f'
			GROUP BY 1
		),
		joined AS (
			SELECT
				a.agent_id,
				COALESCE(s.avg_score, 0.0) as avg_score,
				IF(
					STARTS_WITH(a.agent_uri, 'data:application/json;base64,'),
					JSON_VALUE(SAFE_CONVERT_BYTES_TO_STRING(SAFE.FROM_BASE64(
						SUBSTR(a.agent_uri, LENGTH('data:application/json;base64,') + 1)
					)), '$.x402Support'),
					'false'
				) AS x402_support_str
			FROM agents a
			LEFT JOIN scores s USING (agent_id)
		)
		SELECT
			COUNT(*) AS total_agents,
			COALESCE(ROUND(AVG(NULLIF(avg_score, 0.0)), 2), 0.0) AS avg_reputation,
			COUNTIF(x402_support_str = 'true') AS x402_enabled
		FROM joined;
	`

	q := bqClient.Query(sql)
	it, err := q.Read(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("BigQuery error: %v", err))
		return
	}

	var values []bigquery.Value
	err = it.Next(&values)
	if err != nil && err != iterator.Done {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("Iterator error: %v", err))
		return
	}

	totalAgents := getInt64(values[0])
	avgRep := getFloat64(values[1])
	x402Enabled := getInt64(values[2])

	x402Pct := 0.0
	if totalAgents > 0 {
		x402Pct = (float64(x402Enabled) / float64(totalAgents)) * 100.0
	}

	_ = json.NewEncoder(w).Encode(Stats{
		TotalAgents:      totalAgents,
		AvgReputation:    avgRep,
		X402EnabledCount: x402Enabled,
		X402Percentage:   x402Pct,
	})
}

func handleAnalytics(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// If no credentials, fall back to mock daily registrations
	if !hasCreds || bqClient == nil {
		_ = json.NewEncoder(w).Encode(mockRegs)
		return
	}

	ctx := context.Background()
	sql := `
		SELECT
			DATE(block_timestamp) AS day,
			COUNT(*)              AS new_agents
		FROM ` + "`bigquery-public-data.goog_blockchain_ethereum_mainnet_us.logs`" + `
		WHERE address = '0x8004a169fb4a3325136eb29fa0ceb6d2e539a432'
			AND block_timestamp >= TIMESTAMP '2026-01-28'
			AND topics[SAFE_OFFSET(0)] = '0xca52e62c367d81bb2e328eb795f7c7ba24afb478408a26c0e201d155c449bc4a'
		GROUP BY day
		ORDER BY day;
	`

	q := bqClient.Query(sql)
	it, err := q.Read(ctx)
	if err != nil {
		writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("BigQuery error: %v", err))
		return
	}

	items := []DailyRegistration{}
	for {
		var values []bigquery.Value
		err := it.Next(&values)
		if err == iterator.Done {
			break
		}
		if err != nil {
			writeJSONError(w, http.StatusInternalServerError, fmt.Sprintf("Iterator error: %v", err))
			return
		}

		dayVal := values[0]
		var dayStr string
		switch v := dayVal.(type) {
		case civilDateWrapper:
			dayStr = v.String()
		case time.Time:
			dayStr = v.Format("2006-01-02")
		case string:
			dayStr = v
		default:
			dayStr = fmt.Sprintf("%v", dayVal)
		}

		// Extract date string (often returned as YYYY-MM-DD or time object)
		if len(dayStr) > 10 {
			dayStr = dayStr[:10]
		}

		newAgents := getInt64(values[1])

		items = append(items, DailyRegistration{
			Day:       dayStr,
			NewAgents: newAgents,
		})
	}

	// If no items are returned (e.g. fresh contract or no registrations yet), populate dummy entries for chart baseline
	if len(items) == 0 {
		startDate, _ := time.Parse("2006-01-02", "2026-06-01")
		now := time.Now()
		for startDate.Before(now) {
			items = append(items, DailyRegistration{
				Day:       startDate.Format("2006-01-02"),
				NewAgents: 0,
			})
			startDate = startDate.AddDate(0, 0, 1)
		}
	}

	_ = json.NewEncoder(w).Encode(items)
}

// Help methods to parse BigQuery row values safely
type civilDateWrapper interface {
	String() string
}

func getInt64(v bigquery.Value) int64 {
	if v == nil {
		return 0
	}
	if i, ok := v.(int64); ok {
		return i
	}
	if i, ok := v.(int); ok {
		return int64(i)
	}
	if s, ok := v.(string); ok {
		if val, err := strconv.ParseInt(s, 10, 64); err == nil {
			return val
		}
	}
	return 0
}

func getFloat64(v bigquery.Value) float64 {
	if v == nil {
		return 0.0
	}
	if f, ok := v.(float64); ok {
		return f
	}
	if i, ok := v.(int64); ok {
		return float64(i)
	}
	if s, ok := v.(string); ok {
		if val, err := strconv.ParseFloat(s, 64); err == nil {
			return val
		}
	}
	return 0.0
}

func getString(v bigquery.Value) string {
	if v == nil {
		return ""
	}
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprintf("%v", v)
}

func getBool(v bigquery.Value) bool {
	if v == nil {
		return false
	}
	if b, ok := v.(bool); ok {
		return b
	}
	if s, ok := v.(string); ok {
		return strings.ToLower(s) == "true"
	}
	return false
}
