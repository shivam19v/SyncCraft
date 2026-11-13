// Package docs adapts the generated gRPC client to what the hub needs.
package docs

import (
	"context"
	"errors"

	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	pb "synccraft/gateway/gen/synccraft/v1"
)

var ErrNotFound = errors.New("document not found")

type Client struct{ api pb.DocumentServiceClient }

func New(api pb.DocumentServiceClient) *Client { return &Client{api: api} }

func (c *Client) GetState(ctx context.Context, docID string) (update, vector []byte, err error) {
	res, err := c.api.GetDocumentState(ctx, &pb.GetDocumentStateRequest{DocId: docID})
	if err != nil {
		if status.Code(err) == codes.NotFound {
			return nil, nil, ErrNotFound
		}
		return nil, nil, err
	}
	return res.GetStateUpdate(), res.GetStateVector(), nil
}

func (c *Client) ApplyUpdates(ctx context.Context, docID string, updates [][]byte) error {
	_, err := c.api.ApplyUpdates(ctx, &pb.ApplyUpdatesRequest{DocId: docID, Updates: updates})
	return err
}
