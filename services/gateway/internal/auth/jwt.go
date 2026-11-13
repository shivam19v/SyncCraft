package auth

import (
	"github.com/golang-jwt/jwt/v5"
)

// Claims is the short-lived token minted by the Next.js server for one document.
type Claims struct {
	Name  string `json:"name"`
	Color string `json:"color"`
	Doc   string `json:"doc"`
	jwt.RegisteredClaims
}

type Verifier struct{ key []byte }

func NewVerifier(secret string) *Verifier { return &Verifier{key: []byte(secret)} }

func (v *Verifier) Verify(token string) (*Claims, error) {
	claims := &Claims{}
	_, err := jwt.ParseWithClaims(
		token,
		claims,
		func(*jwt.Token) (any, error) { return v.key, nil },
		jwt.WithValidMethods([]string{"HS256"}),
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, err
	}
	return claims, nil
}
