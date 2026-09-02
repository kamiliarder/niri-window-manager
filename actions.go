package main

import "fmt"

func (n *niriConn) moveWorkspaceUp() error {
	reply, err := n.sendAction("FocusWorkspaceUp")
	if err == nil {
		fmt.Printf("↑ moved workspace up | reply: %s", reply)
	}
	return err
}

func (n *niriConn) moveWorkspaceDown() error {
	reply, err := n.sendAction("FocusWorkspaceDown")
	if err == nil {
		fmt.Printf("↓ moved workspace down | reply: %s", reply)
	}
	return err
}

func (n *niriConn) moveColumnRight() error {
	reply, err := n.sendAction("MoveColumnRight")
	if err == nil {
		fmt.Printf("→ moved column right | reply: %s", reply)
	}
	return err
}

func (n *niriConn) moveColumnLeft() error {
	reply, err := n.sendAction("MoveColumnLeft")
	if err == nil {
		fmt.Printf("← moved column left | reply: %s", reply)
	}
	return err
}

func (n *niriConn) Overview() error {
	reply, err := n.sendAction("ToggleOverview")
	if err == nil {
		fmt.Printf("toggled overview | reply: %s", reply)
	}
	return err
}
func (n *niriConn) CloseWindow() error {
	reply, err := n.sendAction("CloseWindow")
	if err == nil {
		fmt.Printf("Closed Window | reply: %s", reply)
	}
	return err
}
