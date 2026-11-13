package config

import (
	"errors"
	"os"
	"strings"
)

type Config struct {
	Port           string
	RedisURL       string
	DocServiceAddr string
	JWTSecret      string
	AllowedOrigins []string
}

func Load() (Config, error) {
	c := Config{
		Port:           env("PORT", "8080"),
		RedisURL:       env("REDIS_URL", "redis://localhost:6379"),
		DocServiceAddr: env("DOC_SERVICE_ADDR", "localhost:50051"),
		JWTSecret:      os.Getenv("JWT_SECRET"),
	}
	for _, o := range strings.Split(env("ALLOWED_ORIGINS", "localhost:3000"), ",") {
		if o = strings.TrimSpace(o); o != "" {
			c.AllowedOrigins = append(c.AllowedOrigins, o)
		}
	}
	if len(c.JWTSecret) < 16 {
		return c, errors.New("JWT_SECRET must be set and at least 16 characters")
	}
	return c, nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
