// Package money provides a fixed-point currency type so price arithmetic
// never touches float64. Every monetary value in the system (listing
// prices, bids, fees) should be a Cents value, never a float.
package money

import "fmt"

// Cents represents a US-dollar amount as an integer number of cents.
type Cents int64

// String formats the amount as a dollar string, e.g. Cents(1050) -> "$10.50".
func (c Cents) String() string {
	sign := ""
	v := int64(c)
	if v < 0 {
		sign = "-"
		v = -v
	}
	return fmt.Sprintf("%s$%d.%02d", sign, v/100, v%100)
}
